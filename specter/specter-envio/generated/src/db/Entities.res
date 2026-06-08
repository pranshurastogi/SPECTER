open Table
open Enums.EntityType
type id = string

type internalEntity = Internal.entity
module type Entity = {
  type t
  let index: int
  let name: string
  let schema: S.t<t>
  let rowsSchema: S.t<array<t>>
  let table: Table.table
  let entityHistory: EntityHistory.t<t>
}
external entityModToInternal: module(Entity with type t = 'a) => Internal.entityConfig = "%identity"
external entityModsToInternal: array<module(Entity)> => array<Internal.entityConfig> = "%identity"
external entitiesToInternal: array<'a> => array<Internal.entity> = "%identity"

@get
external getEntityId: internalEntity => string = "id"

// Use InMemoryTable.Entity.getEntityIdUnsafe instead of duplicating the logic
let getEntityIdUnsafe = InMemoryTable.Entity.getEntityIdUnsafe

//shorthand for punning
let isPrimaryKey = true
let isNullable = true
let isArray = true
let isIndex = true

@genType
type whereOperations<'entity, 'fieldType> = {
  eq: 'fieldType => promise<array<'entity>>,
  gt: 'fieldType => promise<array<'entity>>,
  lt: 'fieldType => promise<array<'entity>>
}

module AnnouncementEvent = {
  let name = (AnnouncementEvent :> string)
  let index = 0
  @genType
  type t = {
    amount: option<string>,
    blockNumber: bigint,
    blockTimestamp: bigint,
    caller: string,
    ephemeralPubKey: string,
    id: id,
    logIndex: int,
    metadataRaw: string,
    schemeId: bigint,
    sourceChainId: option<bigint>,
    stealthAddress: string,
    transactionHash: string,
    tursoSynced: bool,
    txHash: option<string>,
    viewTag: int,
  }

  let schema = S.object((s): t => {
    amount: s.field("amount", S.null(S.string)),
    blockNumber: s.field("blockNumber", BigInt.schema),
    blockTimestamp: s.field("blockTimestamp", BigInt.schema),
    caller: s.field("caller", S.string),
    ephemeralPubKey: s.field("ephemeralPubKey", S.string),
    id: s.field("id", S.string),
    logIndex: s.field("logIndex", S.int),
    metadataRaw: s.field("metadataRaw", S.string),
    schemeId: s.field("schemeId", BigInt.schema),
    sourceChainId: s.field("sourceChainId", S.null(BigInt.schema)),
    stealthAddress: s.field("stealthAddress", S.string),
    transactionHash: s.field("transactionHash", S.string),
    tursoSynced: s.field("tursoSynced", S.bool),
    txHash: s.field("txHash", S.null(S.string)),
    viewTag: s.field("viewTag", S.int),
  })

  let rowsSchema = S.array(schema)

  @genType
  type indexedFieldOperations = {
    
  }

  let table = mkTable(
    (name :> string),
    ~fields=[
      mkField(
      "amount", 
      Text,
      ~fieldSchema=S.null(S.string),
      
      ~isNullable,
      
      
      
      ),
      mkField(
      "blockNumber", 
      Numeric,
      ~fieldSchema=BigInt.schema,
      
      
      
      
      
      ),
      mkField(
      "blockTimestamp", 
      Numeric,
      ~fieldSchema=BigInt.schema,
      
      
      
      
      
      ),
      mkField(
      "caller", 
      Text,
      ~fieldSchema=S.string,
      
      
      
      
      
      ),
      mkField(
      "ephemeralPubKey", 
      Text,
      ~fieldSchema=S.string,
      
      
      
      
      
      ),
      mkField(
      "id", 
      Text,
      ~fieldSchema=S.string,
      ~isPrimaryKey,
      
      
      
      
      ),
      mkField(
      "logIndex", 
      Integer,
      ~fieldSchema=S.int,
      
      
      
      
      
      ),
      mkField(
      "metadataRaw", 
      Text,
      ~fieldSchema=S.string,
      
      
      
      
      
      ),
      mkField(
      "schemeId", 
      Numeric,
      ~fieldSchema=BigInt.schema,
      
      
      
      
      
      ),
      mkField(
      "sourceChainId", 
      Numeric,
      ~fieldSchema=S.null(BigInt.schema),
      
      ~isNullable,
      
      
      
      ),
      mkField(
      "stealthAddress", 
      Text,
      ~fieldSchema=S.string,
      
      
      
      
      
      ),
      mkField(
      "transactionHash", 
      Text,
      ~fieldSchema=S.string,
      
      
      
      
      
      ),
      mkField(
      "tursoSynced", 
      Boolean,
      ~fieldSchema=S.bool,
      
      
      
      
      
      ),
      mkField(
      "txHash", 
      Text,
      ~fieldSchema=S.null(S.string),
      
      ~isNullable,
      
      
      
      ),
      mkField(
      "viewTag", 
      Integer,
      ~fieldSchema=S.int,
      
      
      
      
      
      ),
    ],
  )

  let entityHistory = table->EntityHistory.fromTable(~schema, ~entityIndex=index)

  external castToInternal: t => Internal.entity = "%identity"
}

let userEntities = [
  module(AnnouncementEvent),
]->entityModsToInternal

let allEntities =
  userEntities->Js.Array2.concat(
    [module(InternalTable.DynamicContractRegistry)]->entityModsToInternal,
  )

let byName =
  allEntities
  ->Js.Array2.map(entityConfig => {
    (entityConfig.name, entityConfig)
  })
  ->Js.Dict.fromArray
