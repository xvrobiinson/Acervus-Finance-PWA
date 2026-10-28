import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hourly, because each business's day starts at a different UTC hour.
crons.interval("record late fees", { hours: 1 }, internal.lateFees.refreshAll, {});

export default crons;
