import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("security scan", { minutes: 5 }, internal.monitor.scan, {});
crons.daily("purge old security events", { hourUTC: 2, minuteUTC: 0 }, internal.monitor.purge, {});
export default crons;
