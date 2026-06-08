/* TypeScript file generated from Entities.res by genType. */

/* eslint-disable */
/* tslint:disable */

export type id = string;

export type whereOperations<entity,fieldType> = {
  readonly eq: (_1:fieldType) => Promise<entity[]>; 
  readonly gt: (_1:fieldType) => Promise<entity[]>; 
  readonly lt: (_1:fieldType) => Promise<entity[]>
};

export type AnnouncementEvent_t = {
  readonly amount: (undefined | string); 
  readonly blockNumber: bigint; 
  readonly blockTimestamp: bigint; 
  readonly caller: string; 
  readonly ephemeralPubKey: string; 
  readonly id: id; 
  readonly logIndex: number; 
  readonly metadataRaw: string; 
  readonly schemeId: bigint; 
  readonly sourceChainId: (undefined | bigint); 
  readonly stealthAddress: string; 
  readonly transactionHash: string; 
  readonly tursoSynced: boolean; 
  readonly txHash: (undefined | string); 
  readonly viewTag: number
};

export type AnnouncementEvent_indexedFieldOperations = {};
