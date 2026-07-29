/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const {
  stdin: input,
  stdout: output,
} = require("node:process");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const APPLY_FLAG = "--apply";
const CONFIRM_TEXT = "RESOLVE ALL PROBLEM TICKETS";

function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((step) => String(step || "").trim())
    .filter(Boolean);
}

function createBackup(tickets) {
  const backupDirectory = path.resolve(
    process.cwd(),
    "backups",
  );

  fs.mkdirSync(backupDirectory, {
    recursive: true,
  });

  const backupPath = path.join(
    backupDirectory,
    `problem-tickets-before-resolve-${createTimestamp()}.json`,
  );

  const backupData = {
    meta: {
      createdAt: new Date().toISOString(),
      table: "ProblemTicket",
      count: tickets.length,
      operation: "Backup before resolving all problem tickets",
    },

    data: tickets,
  };

  fs.writeFileSync(
    backupPath,
    JSON.stringify(backupData, null, 2),
    "utf8",
  );

  return backupPath;
}

async function main() {
  const shouldApply =
    process.argv.includes(APPLY_FLAG);

  console.log("");
  console.log("========================================");
  console.log(" SmartIT Problem Tickets Resolve Tool");
  console.log("========================================");
  console.log("");

  const tickets =
    await prisma.problemTicket.findMany({
      orderBy: {
        id: "asc",
      },
    });

  const openCount = tickets.filter(
    (ticket) => ticket.status === "OPEN",
  ).length;

  const inProgressCount = tickets.filter(
    (ticket) => ticket.status === "IN_PROGRESS",
  ).length;

  const resolvedCount = tickets.filter(
    (ticket) => ticket.status === "RESOLVED",
  ).length;

  console.log(`Total tickets: ${tickets.length}`);
  console.log(`Open: ${openCount}`);
  console.log(`In Progress: ${inProgressCount}`);
  console.log(`Already Resolved: ${resolvedCount}`);
  console.log("");

  const backupPath = createBackup(tickets);

  console.log("Backup created successfully:");
  console.log(backupPath);
  console.log("");

  /*
   * بدون --apply:
   * نعمل Backup فقط ولا نغير أي بيانات.
   */
  if (!shouldApply) {
    console.log("No data was changed.");
    console.log("");
    console.log("After checking the backup, run:");
    console.log("");
    console.log(
      "node .\\prisma\\scripts\\backup-and-resolve-problem-tickets.cjs --apply",
    );
    console.log("");

    return;
  }

  if (tickets.length === 0) {
    console.log("ProblemTicket table is empty.");
    console.log("Nothing to update.");
    return;
  }

  const ticketsToResolve = tickets.filter(
    (ticket) => ticket.status !== "RESOLVED",
  );

  if (ticketsToResolve.length === 0) {
    console.log("All ProblemTicket rows are already resolved.");
    return;
  }

  console.log(
    `This will mark ${ticketsToResolve.length} ticket(s) as RESOLVED.`,
  );

  console.log(
    "No ticket will be deleted.",
  );

  console.log("");

  const readlineInterface =
    readline.createInterface({
      input,
      output,
    });

  const answer =
    await readlineInterface.question(
      `Type exactly "${CONFIRM_TEXT}" to continue: `,
    );

  readlineInterface.close();

  if (answer.trim() !== CONFIRM_TEXT) {
    console.log("");
    console.log("Confirmation did not match.");
    console.log("Nothing was changed.");
    return;
  }

  const now = new Date();

  const updateOperations =
    ticketsToResolve.map((ticket) => {
      const existingSteps =
        normalizeSteps(ticket.solutionSteps);

      const existingSolutionText =
        String(ticket.solutionText || "").trim();

      /*
       * لو الحل موجود في الإكسيل نحتفظ به.
       * لو الحل كان فارغًا نضع نصًا عامًا حتى تظل
       * بيانات المشكلة المحلولة مكتملة.
       */
      const solutionText =
        existingSolutionText ||
        "تم تنفيذ الإجراء المطلوب وإغلاق المشكلة وفق السجل اليومي المستورد.";

      const solutionSteps =
        existingSteps.length > 0
          ? existingSteps
          : [solutionText];

      const resolvedAt =
        ticket.resolvedAt ||
        ticket.problemDate ||
        ticket.createdAt ||
        now;

      const resolvedById =
        ticket.resolvedById ||
        ticket.assignedToId ||
        ticket.createdById;

      const assignedToId =
        ticket.assignedToId ||
        ticket.createdById;

      return prisma.problemTicket.update({
        where: {
          id: ticket.id,
        },

        data: {
          status: "RESOLVED",

          solutionText,

          solutionSteps,

          resultNotes:
            String(ticket.resultNotes || "").trim() ||
            "تم الحل",

          assignedToId,

          resolvedById,

          startedAt:
            ticket.startedAt ||
            ticket.problemDate ||
            ticket.createdAt ||
            now,

          resolvedAt,

          statusDate: resolvedAt,
        },
      });
    });

  /*
   * جميع التعديلات داخل Transaction واحدة.
   * لو حدث خطأ يتم التراجع عن التعديلات كلها.
   */
  const updatedTickets =
    await prisma.$transaction(
      updateOperations,
    );

  console.log("");
  console.log("Operation completed successfully.");
  console.log(
    `Tickets marked as Resolved: ${updatedTickets.length}`,
  );

  console.log("");
  console.log("No rows were deleted.");
  console.log("Backup retained at:");
  console.log(backupPath);
  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error("Operation failed.");
    console.error(
      "The database transaction was not completed successfully.",
    );
    console.error("");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });