import { v } from "convex/values";
import * as K from "./domain/tickets";
import { userMutation, userQuery } from "./lib/functions";
import { vSeverity, vTicketKind, vTicketStatus } from "./schema";

export const list = userQuery({
  args: { workspaceId: v.id("workspaces"), projectId: v.optional(v.id("projects")), status: v.optional(vTicketStatus), open: v.optional(v.boolean()) },
  handler: (ctx, { workspaceId, ...filter }) => K.listTickets(ctx, ctx.actor, workspaceId, filter),
});

export const get = userQuery({
  args: { ticketId: v.id("tickets") },
  handler: (ctx, { ticketId }) => K.ticketDetail(ctx, ctx.actor, ticketId),
});

export const create = userMutation({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    kind: vTicketKind,
    title: v.string(),
    body: v.optional(v.string()),
    severity: v.optional(vSeverity),
  },
  handler: (ctx, args) => K.createTicket(ctx, ctx.actor, args),
});

export const update = userMutation({
  args: {
    ticketId: v.id("tickets"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    kind: v.optional(vTicketKind),
    severity: v.optional(vSeverity),
    status: v.optional(vTicketStatus),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
  },
  handler: (ctx, { ticketId, ...patch }) => K.updateTicket(ctx, ctx.actor, ticketId, patch),
});

export const link = userMutation({
  args: { ticketId: v.id("tickets"), taskId: v.id("tasks"), relation: v.union(v.literal("implements"), v.literal("duplicates"), v.literal("relates")) },
  handler: (ctx, { ticketId, taskId, relation }) => K.linkTicket(ctx, ctx.actor, ticketId, taskId, relation),
});

export const unlink = userMutation({
  args: { linkId: v.id("ticketLinks") },
  handler: (ctx, { linkId }) => K.unlinkTicket(ctx, ctx.actor, linkId),
});

export const remove = userMutation({
  args: { ticketId: v.id("tickets") },
  handler: (ctx, { ticketId }) => K.deleteTicket(ctx, ctx.actor, ticketId),
});
