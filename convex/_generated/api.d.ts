/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agent_api from "../agent/api.js";
import type * as agent_gate from "../agent/gate.js";
import type * as agents from "../agents.js";
import type * as auth from "../auth.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as domain_comments from "../domain/comments.js";
import type * as domain_contract from "../domain/contract.js";
import type * as domain_flow from "../domain/flow.js";
import type * as domain_ingest from "../domain/ingest.js";
import type * as domain_projects from "../domain/projects.js";
import type * as domain_sync from "../domain/sync.js";
import type * as domain_tasks from "../domain/tasks.js";
import type * as domain_tickets from "../domain/tickets.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_random from "../lib/random.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_security from "../lib/security.js";
import type * as lib_superAdmin from "../lib/superAdmin.js";
import type * as monitor from "../monitor.js";
import type * as notifications from "../notifications.js";
import type * as projects from "../projects.js";
import type * as search from "../search.js";
import type * as tasks from "../tasks.js";
import type * as tickets from "../tickets.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "agent/api": typeof agent_api;
  "agent/gate": typeof agent_gate;
  agents: typeof agents;
  auth: typeof auth;
  comments: typeof comments;
  crons: typeof crons;
  "domain/comments": typeof domain_comments;
  "domain/contract": typeof domain_contract;
  "domain/flow": typeof domain_flow;
  "domain/ingest": typeof domain_ingest;
  "domain/projects": typeof domain_projects;
  "domain/sync": typeof domain_sync;
  "domain/tasks": typeof domain_tasks;
  "domain/tickets": typeof domain_tickets;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/activity": typeof lib_activity;
  "lib/functions": typeof lib_functions;
  "lib/random": typeof lib_random;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/security": typeof lib_security;
  "lib/superAdmin": typeof lib_superAdmin;
  monitor: typeof monitor;
  notifications: typeof notifications;
  projects: typeof projects;
  search: typeof search;
  tasks: typeof tasks;
  tickets: typeof tickets;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
