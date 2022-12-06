import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, Index as Index_, OneToMany as OneToMany_} from "typeorm"
import {Transfer} from "./transfer.model"

@Entity_()
export class Account {
    constructor(props?: Partial<Account>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @Column_("text", {nullable: true})
    evmAddress!: string | undefined | null

    @OneToMany_(() => Transfer, e => e.from)
    transfersSent!: Transfer[]

    @OneToMany_(() => Transfer, e => e.to)
    transfersReceived!: Transfer[]
}
