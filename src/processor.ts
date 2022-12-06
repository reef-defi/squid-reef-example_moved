import { Store, TypeormDatabase } from "@subsquid/typeorm-store";
import {
  BatchContext,
  BatchProcessorItem,
  SubstrateBatchProcessor,
  SubstrateBlock,
} from "@subsquid/substrate-processor";
import { In } from "typeorm";
import { EventItem } from "@subsquid/substrate-processor/lib/interfaces/dataSelection";
import { getEvmLog } from "@subsquid/substrate-frontier-evm";
import * as erc20 from "./abi/ERC20";
import { Account, Transfer } from "./model/generated";
import { ethers } from "ethers";
import { Provider } from "@reef-defi/evm-provider";
import { WsProvider } from "@polkadot/api";

const RPC_URL = "wss://rpc.reefscan.com/ws";
const REEF_CONTRACT_ADDRESS = "0x0000000000000000000000000000000001000000";

const provider = new Provider({
  provider: new WsProvider(RPC_URL),
});
const database = new TypeormDatabase();
const processor = new SubstrateBatchProcessor()
  .setDataSource({
    chain: RPC_URL,
    archive: "http://localhost:8888/graphql", // Use local archive API
    // archive: lookupArchive('reef', {release: "FireSquid"})}) // Use Aquarium archive API
  })
  .setTypesBundle("reef")
  .addEvmLog(REEF_CONTRACT_ADDRESS, {
    filter: [erc20.events.Transfer.topic],
    data: {
      event: {
        args: true,
        call: true,
      },
    },
  });
export type Item = BatchProcessorItem<typeof processor>;
export type Context = BatchContext<Store, Item>;

processor.run(database, async (ctx) => {
  await provider.api.isReadyOrError;

  const transfersData: TransferData[] = [];

  for (const block of ctx.blocks) {
    for (const item of block.items) {
      if (item.name === "EVM.Log") {
        const transfer = await handleTransfer(ctx, block.header, item);
        transfersData.push(transfer);
      }
    }
  }

  await saveTransfers(ctx, transfersData);
});

type TransferData = {
  id: string;
  fromNative: string;
  fromEvm: string;
  toNative: string;
  toEvm: string;
  amount: bigint;
  timestamp: bigint;
  blockNumber: number;
};

async function handleTransfer(
  ctx: Context,
  block: SubstrateBlock,
  item: EventItem<"EVM.Log", { event: { args: true; call: { args: true } } }>
): Promise<TransferData> {
  let evmLog = getEvmLog(ctx, item.event);
  const { from, to, value } = erc20.events.Transfer.decode(evmLog);

  const transfer: TransferData = {
    id: item.event.id,
    fromNative: await findNativeAddress(from),
    fromEvm: from,
    toNative: await findNativeAddress(to),
    toEvm: to,
    amount: BigInt(value.toString()),
    timestamp: BigInt(block.timestamp),
    blockNumber: block.height,
  };

  return transfer;
}

async function saveTransfers(ctx: Context, transfersData: TransferData[]) {
  const accountIds: Set<string> = new Set();
  for (const transferData of transfersData) {
    accountIds.add(transferData.fromNative);
    accountIds.add(transferData.toNative);
  }

  const accounts = await ctx.store
    .findBy(Account, { id: In([...accountIds]) })
    .then((q) => new Map(q.map((i) => [i.id, i])));

  const transfers: Transfer[] = [];

  for (const transferData of transfersData) {
    let from = accounts.get(transferData.fromNative);
    if (from == null) {
      from = new Account({
        id: transferData.fromNative,
        evmAddress: transferData.fromEvm,
      });
      accounts.set(from.id, from);
    }

    let to = accounts.get(transferData.toNative);
    if (to == null) {
      to = new Account({
        id: transferData.toNative,
        evmAddress: transferData.toEvm,
      });
      accounts.set(to.id, to);
    }

    const { id, amount, blockNumber, timestamp } = transferData;

    const transfer = new Transfer({
      id,
      blockNumber,
      timestamp,
      from,
      to,
      amount,
    });

    transfers.push(transfer);
  }

  await ctx.store.save([...accounts.values()]);
  await ctx.store.save(transfers);
}

async function findNativeAddress(evmAddress: string): Promise<string> {
  if (
    !ethers.utils.isAddress(evmAddress) ||
    evmAddress === ethers.constants.AddressZero
  )
    return "0x";
  const address = await provider.api.query.evmAccounts.accounts(evmAddress);
  return address.toString();
}
