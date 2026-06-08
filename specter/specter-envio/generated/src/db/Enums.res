module ContractType = {
  @genType
  type t = 
    | @as("SPECTERAnnouncer") SPECTERAnnouncer

  let name = "CONTRACT_TYPE"
  let variants = [
    SPECTERAnnouncer,
  ]
  let config = Internal.makeEnumConfig(~name, ~variants)
}

module EntityType = {
  @genType
  type t = 
    | @as("AnnouncementEvent") AnnouncementEvent
    | @as("dynamic_contract_registry") DynamicContractRegistry

  let name = "ENTITY_TYPE"
  let variants = [
    AnnouncementEvent,
    DynamicContractRegistry,
  ]
  let config = Internal.makeEnumConfig(~name, ~variants)
}

let allEnums = ([
  ContractType.config->Internal.fromGenericEnumConfig,
  EntityType.config->Internal.fromGenericEnumConfig,
])
