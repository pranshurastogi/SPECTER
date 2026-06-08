/* TypeScript file generated from Types.res by genType. */

/* eslint-disable */
/* tslint:disable */

import type {AnnouncementEvent_t as Entities_AnnouncementEvent_t} from '../src/db/Entities.gen';

import type {HandlerContext as $$handlerContext} from './Types.ts';

import type {HandlerWithOptions as $$fnWithEventConfig} from './bindings/OpaqueTypes.ts';

import type {LoaderContext as $$loaderContext} from './Types.ts';

import type {SingleOrMultiple as $$SingleOrMultiple_t} from './bindings/OpaqueTypes';

import type {entityHandlerContext as Internal_entityHandlerContext} from 'envio/src/Internal.gen';

import type {eventOptions as Internal_eventOptions} from 'envio/src/Internal.gen';

import type {genericContractRegisterArgs as Internal_genericContractRegisterArgs} from 'envio/src/Internal.gen';

import type {genericContractRegister as Internal_genericContractRegister} from 'envio/src/Internal.gen';

import type {genericEvent as Internal_genericEvent} from 'envio/src/Internal.gen';

import type {genericHandlerArgs as Internal_genericHandlerArgs} from 'envio/src/Internal.gen';

import type {genericHandlerWithLoader as Internal_genericHandlerWithLoader} from 'envio/src/Internal.gen';

import type {genericHandler as Internal_genericHandler} from 'envio/src/Internal.gen';

import type {genericLoaderArgs as Internal_genericLoaderArgs} from 'envio/src/Internal.gen';

import type {genericLoader as Internal_genericLoader} from 'envio/src/Internal.gen';

import type {logger as Envio_logger} from 'envio/src/Envio.gen';

import type {t as Address_t} from 'envio/src/Address.gen';

export type id = string;
export type Id = id;

export type contractRegistrations = { readonly log: Envio_logger; readonly addSPECTERAnnouncer: (_1:Address_t) => void };

export type entityLoaderContext<entity,indexedFieldOperations> = {
  readonly get: (_1:id) => Promise<(undefined | entity)>; 
  readonly getOrThrow: (_1:id, message:(undefined | string)) => Promise<entity>; 
  readonly getWhere: indexedFieldOperations; 
  readonly getOrCreate: (_1:entity) => Promise<entity>; 
  readonly set: (_1:entity) => void; 
  readonly deleteUnsafe: (_1:id) => void
};

export type loaderContext = $$loaderContext;

export type entityHandlerContext<entity> = Internal_entityHandlerContext<entity>;

export type handlerContext = $$handlerContext;

export type announcementEvent = Entities_AnnouncementEvent_t;
export type AnnouncementEvent = announcementEvent;

export type Transaction_t = { readonly hash: string };

export type Block_t = {
  readonly number: number; 
  readonly timestamp: number; 
  readonly hash: string
};

export type AggregatedBlock_t = {
  readonly hash: string; 
  readonly number: number; 
  readonly timestamp: number
};

export type AggregatedTransaction_t = { readonly hash: string };

export type eventLog<params> = Internal_genericEvent<params,Block_t,Transaction_t>;
export type EventLog<params> = eventLog<params>;

export type SingleOrMultiple_t<a> = $$SingleOrMultiple_t<a>;

export type HandlerTypes_args<eventArgs,context> = { readonly event: eventLog<eventArgs>; readonly context: context };

export type HandlerTypes_contractRegisterArgs<eventArgs> = Internal_genericContractRegisterArgs<eventLog<eventArgs>,contractRegistrations>;

export type HandlerTypes_contractRegister<eventArgs> = Internal_genericContractRegister<HandlerTypes_contractRegisterArgs<eventArgs>>;

export type HandlerTypes_loaderArgs<eventArgs> = Internal_genericLoaderArgs<eventLog<eventArgs>,loaderContext>;

export type HandlerTypes_loader<eventArgs,loaderReturn> = Internal_genericLoader<HandlerTypes_loaderArgs<eventArgs>,loaderReturn>;

export type HandlerTypes_handlerArgs<eventArgs,loaderReturn> = Internal_genericHandlerArgs<eventLog<eventArgs>,handlerContext,loaderReturn>;

export type HandlerTypes_handler<eventArgs,loaderReturn> = Internal_genericHandler<HandlerTypes_handlerArgs<eventArgs,loaderReturn>>;

export type HandlerTypes_loaderHandler<eventArgs,loaderReturn,eventFilters> = Internal_genericHandlerWithLoader<HandlerTypes_loader<eventArgs,loaderReturn>,HandlerTypes_handler<eventArgs,loaderReturn>,eventFilters>;

export type HandlerTypes_eventConfig<eventFilters> = Internal_eventOptions<eventFilters>;

export type fnWithEventConfig<fn,eventConfig> = $$fnWithEventConfig<fn,eventConfig>;

export type handlerWithOptions<eventArgs,loaderReturn,eventFilters> = fnWithEventConfig<HandlerTypes_handler<eventArgs,loaderReturn>,HandlerTypes_eventConfig<eventFilters>>;

export type contractRegisterWithOptions<eventArgs,eventFilters> = fnWithEventConfig<HandlerTypes_contractRegister<eventArgs>,HandlerTypes_eventConfig<eventFilters>>;

export type SPECTERAnnouncer_chainId = 10143;

export type SPECTERAnnouncer_Announcement_eventArgs = {
  readonly schemeId: bigint; 
  readonly stealthAddress: Address_t; 
  readonly caller: Address_t; 
  readonly ephemeralPubKey: string; 
  readonly metadata: string
};

export type SPECTERAnnouncer_Announcement_block = Block_t;

export type SPECTERAnnouncer_Announcement_transaction = Transaction_t;

export type SPECTERAnnouncer_Announcement_event = {
  /** The parameters or arguments associated with this event. */
  readonly params: SPECTERAnnouncer_Announcement_eventArgs; 
  /** The unique identifier of the blockchain network where this event occurred. */
  readonly chainId: SPECTERAnnouncer_chainId; 
  /** The address of the contract that emitted this event. */
  readonly srcAddress: Address_t; 
  /** The index of this event's log within the block. */
  readonly logIndex: number; 
  /** The transaction that triggered this event. Configurable in `config.yaml` via the `field_selection` option. */
  readonly transaction: SPECTERAnnouncer_Announcement_transaction; 
  /** The block in which this event was recorded. Configurable in `config.yaml` via the `field_selection` option. */
  readonly block: SPECTERAnnouncer_Announcement_block
};

export type SPECTERAnnouncer_Announcement_loaderArgs = Internal_genericLoaderArgs<SPECTERAnnouncer_Announcement_event,loaderContext>;

export type SPECTERAnnouncer_Announcement_loader<loaderReturn> = Internal_genericLoader<SPECTERAnnouncer_Announcement_loaderArgs,loaderReturn>;

export type SPECTERAnnouncer_Announcement_handlerArgs<loaderReturn> = Internal_genericHandlerArgs<SPECTERAnnouncer_Announcement_event,handlerContext,loaderReturn>;

export type SPECTERAnnouncer_Announcement_handler<loaderReturn> = Internal_genericHandler<SPECTERAnnouncer_Announcement_handlerArgs<loaderReturn>>;

export type SPECTERAnnouncer_Announcement_contractRegister = Internal_genericContractRegister<Internal_genericContractRegisterArgs<SPECTERAnnouncer_Announcement_event,contractRegistrations>>;

export type SPECTERAnnouncer_Announcement_eventFilter = {
  readonly schemeId?: SingleOrMultiple_t<bigint>; 
  readonly stealthAddress?: SingleOrMultiple_t<Address_t>; 
  readonly caller?: SingleOrMultiple_t<Address_t>
};

export type SPECTERAnnouncer_Announcement_eventFiltersArgs = { 
/** The unique identifier of the blockchain network where this event occurred. */
readonly chainId: SPECTERAnnouncer_chainId; 
/** Addresses of the contracts indexing the event. */
readonly addresses: Address_t[] };

export type SPECTERAnnouncer_Announcement_eventFiltersDefinition = 
    SPECTERAnnouncer_Announcement_eventFilter
  | SPECTERAnnouncer_Announcement_eventFilter[];

export type SPECTERAnnouncer_Announcement_eventFilters = 
    SPECTERAnnouncer_Announcement_eventFilter
  | SPECTERAnnouncer_Announcement_eventFilter[]
  | ((_1:SPECTERAnnouncer_Announcement_eventFiltersArgs) => SPECTERAnnouncer_Announcement_eventFiltersDefinition);

export type chainId = number;

export type chain = 10143;
