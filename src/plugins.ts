/**
 * Plugin utilities.
 */
import type {
  ClientOptions,
  Descriptor,
  Endpoint,
  Handlers,
  Initials,
  ServiceOptions,
  TransportConfig,
} from './types.ts';
import { Service } from './Service.ts';
import { Client } from './Client.ts';

/**
 * Plugin definition for extending a service spec.
 */
export interface ServicePlugin {
  name: string;
  endpoints?: Endpoint[];
  handlers?: Handlers;
  /**
   * Wrap or augment RPC handlers before Service construction.
   */
  wrapHandlers?: (handlers: Handlers) => Handlers;
  /**
   * Called after Service is ready. Use to attach listeners or wrap endpoint methods.
   */
  onServiceReady?: (service: Service, descriptor: Descriptor) => void;
}

/**
 * Service spec for shared descriptor + plugins.
 */
export interface ServiceSpec {
  descriptor: Descriptor;
  plugins: ServicePlugin[];
  initials?: Initials;
}

/**
 * Input shape for defineServiceSpec.
 */
export interface DefineServiceSpecInput {
  transport: TransportConfig;
  endpoints?: Endpoint[];
  plugins?: ServicePlugin[];
  initials?: Initials;
}

const RESERVED_ENDPOINTS = new Set(['_descriptor']);

/**
 * Define a service spec by merging base endpoints with plugin endpoints.
 */
export function defineServiceSpec(input: DefineServiceSpecInput): ServiceSpec {
  const plugins = input.plugins ?? [];
  const endpoints: Endpoint[] = [];
  const names = new Set<string>();

  const addEndpoint = (endpoint: Endpoint, source: string) => {
    if (RESERVED_ENDPOINTS.has(endpoint.name)) {
      throw new Error(`Endpoint name reserved: ${endpoint.name} (from ${source})`);
    }
    if (names.has(endpoint.name)) {
      throw new Error(`Duplicate endpoint name: ${endpoint.name} (from ${source})`);
    }
    names.add(endpoint.name);
    endpoints.push(endpoint);
  };

  for (const endpoint of input.endpoints ?? []) {
    addEndpoint(endpoint, 'spec');
  }

  for (const plugin of plugins) {
    for (const endpoint of plugin.endpoints ?? []) {
      addEndpoint(endpoint, `plugin:${plugin.name}`);
    }
  }

  return {
    descriptor: {
      transport: input.transport,
      endpoints,
    },
    plugins,
    ...(input.initials ? { initials: input.initials } : {}),
  };
}

/**
 * Create a Service from a spec, merging plugin handlers with service handlers.
 */
export function createService(
  spec: ServiceSpec,
  handlers: Handlers,
  initials: Initials = {},
  options?: ServiceOptions
): Service {
  const pluginHandlers: Handlers = {};

  for (const plugin of spec.plugins) {
    if (!plugin.handlers) continue;
    for (const [name, handler] of Object.entries(plugin.handlers)) {
      if (pluginHandlers[name]) {
        throw new Error(`Duplicate plugin handler: ${name} (from plugin ${plugin.name})`);
      }
      pluginHandlers[name] = handler;
    }
  }

  for (const name of Object.keys(handlers)) {
    if (pluginHandlers[name]) {
      throw new Error(`Handler collision: ${name} (already provided by plugin)`);
    }
  }

  let mergedHandlers: Handlers = {
    ...pluginHandlers,
    ...handlers,
  };

  for (const plugin of spec.plugins) {
    if (plugin.wrapHandlers) {
      mergedHandlers = plugin.wrapHandlers(mergedHandlers);
    }
  }

  const mergedInitials: Initials = {
    ...(spec.initials ?? {}),
    ...initials,
  };

  const service = new Service(spec.descriptor, mergedHandlers, mergedInitials, options);

  for (const plugin of spec.plugins) {
    if (plugin.onServiceReady) {
      service.ready()
        .then(() => plugin.onServiceReady!(service, spec.descriptor))
        .catch(() => {
          // Ignore plugin errors on startup; Service.ready() will surface its own errors.
        });
    }
  }

  return service;
}

/**
 * Create a Client from a spec.
 */
export function createClient(spec: ServiceSpec, options?: ClientOptions): Client {
  return new Client(spec.descriptor, options);
}
