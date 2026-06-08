/* TypeScript file generated from TestHelpers.res by genType. */

/* eslint-disable */
/* tslint:disable */

const TestHelpersJS = require('./TestHelpers.res.js');

import type {SPECTERAnnouncer_Announcement_event as Types_SPECTERAnnouncer_Announcement_event} from './Types.gen';

import type {t as Address_t} from 'envio/src/Address.gen';

import type {t as TestHelpers_MockDb_t} from './TestHelpers_MockDb.gen';

/** The arguements that get passed to a "processEvent" helper function */
export type EventFunctions_eventProcessorArgs<event> = {
  readonly event: event; 
  readonly mockDb: TestHelpers_MockDb_t; 
  readonly chainId?: number
};

export type EventFunctions_eventProcessor<event> = (_1:EventFunctions_eventProcessorArgs<event>) => Promise<TestHelpers_MockDb_t>;

export type EventFunctions_MockBlock_t = {
  readonly hash?: string; 
  readonly number?: number; 
  readonly timestamp?: number
};

export type EventFunctions_MockTransaction_t = { readonly hash?: string };

export type EventFunctions_mockEventData = {
  readonly chainId?: number; 
  readonly srcAddress?: Address_t; 
  readonly logIndex?: number; 
  readonly block?: EventFunctions_MockBlock_t; 
  readonly transaction?: EventFunctions_MockTransaction_t
};

export type SPECTERAnnouncer_Announcement_createMockArgs = {
  readonly schemeId?: bigint; 
  readonly stealthAddress?: Address_t; 
  readonly caller?: Address_t; 
  readonly ephemeralPubKey?: string; 
  readonly metadata?: string; 
  readonly mockEventData?: EventFunctions_mockEventData
};

export const MockDb_createMockDb: () => TestHelpers_MockDb_t = TestHelpersJS.MockDb.createMockDb as any;

export const Addresses_mockAddresses: Address_t[] = TestHelpersJS.Addresses.mockAddresses as any;

export const Addresses_defaultAddress: Address_t = TestHelpersJS.Addresses.defaultAddress as any;

export const SPECTERAnnouncer_Announcement_processEvent: EventFunctions_eventProcessor<Types_SPECTERAnnouncer_Announcement_event> = TestHelpersJS.SPECTERAnnouncer.Announcement.processEvent as any;

export const SPECTERAnnouncer_Announcement_createMockEvent: (args:SPECTERAnnouncer_Announcement_createMockArgs) => Types_SPECTERAnnouncer_Announcement_event = TestHelpersJS.SPECTERAnnouncer.Announcement.createMockEvent as any;

export const Addresses: { mockAddresses: Address_t[]; defaultAddress: Address_t } = TestHelpersJS.Addresses as any;

export const SPECTERAnnouncer: { Announcement: { processEvent: EventFunctions_eventProcessor<Types_SPECTERAnnouncer_Announcement_event>; createMockEvent: (args:SPECTERAnnouncer_Announcement_createMockArgs) => Types_SPECTERAnnouncer_Announcement_event } } = TestHelpersJS.SPECTERAnnouncer as any;

export const MockDb: { createMockDb: () => TestHelpers_MockDb_t } = TestHelpersJS.MockDb as any;
