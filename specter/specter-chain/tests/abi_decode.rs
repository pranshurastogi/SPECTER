//! Verifies the SPECTERAnnouncer ABI bindings match the deployed event:
//! schemeId NOT indexed, ephemeralKeyHash is bytes32.

use alloy::primitives::Address;
use alloy::sol_types::{SolEvent, TopicList};
use specter_chain::contract::SPECTERAnnouncer;

#[test]
fn announcement_event_has_two_indexed_topics_plus_signature() {
    // 1 topic for the event signature + 2 indexed params (stealthAddress, caller).
    // schemeId is NOT indexed in the new contract.
    // In alloy 0.8, the total topic count is the `TopicList::COUNT` of the event,
    // which for a non-anonymous event = 1 (signature) + #indexed params.
    type Topics = <SPECTERAnnouncer::Announcement as SolEvent>::TopicList;
    assert_eq!(<Topics as TopicList>::COUNT, 3);
}

#[test]
fn announce_call_roundtrips() {
    use alloy::sol_types::SolCall;
    // The 3-arg `announce` overload is renamed by alloy's `sol!` to `announce_0Call`
    // (the 4-arg schemeId overload becomes `announce_1Call`).
    let call = SPECTERAnnouncer::announce_0Call {
        stealthAddress: Address::ZERO,
        ephemeralPubKey: vec![0u8; 1088].into(),
        metadata: vec![0x7Fu8].into(),
    };
    let encoded = call.abi_encode();
    let decoded = SPECTERAnnouncer::announce_0Call::abi_decode(&encoded, true).unwrap();
    assert_eq!(decoded.ephemeralPubKey.len(), 1088);
    assert_eq!(decoded.metadata[0], 0x7F);
}
