const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const GLOBAL_KINDS = ["GLOBAL_ROUTE", "SOFTWARE_CHECK"];
const CONFIRM = "DELETE TEST DATA";

const ids = (rows) => [...new Set(rows.map((r) => Number(r.id)).filter((x) => x > 0))];
const nums = (values) => [...new Set(values.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
const or = (...parts) => parts.filter(Boolean);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function collect() {
  const inspectionTasks = await prisma.inspectionTask.findMany({
    where: { taskKind: { in: GLOBAL_KINDS } },
    orderBy: { id: "asc" },
  });
  const taskIds = ids(inspectionTasks);

  const inspectionTaskItems = taskIds.length
    ? await prisma.inspectionTaskItem.findMany({
        where: { taskId: { in: taskIds } },
        orderBy: { id: "asc" },
      })
    : [];
  const taskItemIds = ids(inspectionTaskItems);
  const itemInspectionIds = nums(inspectionTaskItems.map((x) => x.inspectionId));

  const inspections = taskIds.length || itemInspectionIds.length
    ? await prisma.inspection.findMany({
        where: {
          OR: or(
            taskIds.length ? { taskId: { in: taskIds } } : null,
            itemInspectionIds.length ? { id: { in: itemInspectionIds } } : null,
          ),
        },
        orderBy: { id: "asc" },
      })
    : [];
  const inspectionIds = ids(inspections);

  const issueCategories = await prisma.issueCategory.findMany({ orderBy: { id: "asc" } });
  const issues = await prisma.issue.findMany({ orderBy: { id: "asc" } });
  const issueIds = ids(issues);
  const issueSolutions = await prisma.issueSolution.findMany({ orderBy: { id: "asc" } });
  const solutionIds = ids(issueSolutions);

  const inspectionIssues = inspectionIds.length || issueIds.length
    ? await prisma.inspectionIssue.findMany({
        where: {
          OR: or(
            inspectionIds.length ? { inspectionId: { in: inspectionIds } } : null,
            issueIds.length ? { issueId: { in: issueIds } } : null,
          ),
        },
        orderBy: { id: "asc" },
      })
    : [];
  const inspectionIssueIds = ids(inspectionIssues);

  const inspectionIssueSolutionActions =
    inspectionIds.length || inspectionIssueIds.length || solutionIds.length
      ? await prisma.inspectionIssueSolutionAction.findMany({
          where: {
            OR: or(
              inspectionIds.length ? { inspectionId: { in: inspectionIds } } : null,
              inspectionIssueIds.length ? { inspectionIssueId: { in: inspectionIssueIds } } : null,
              solutionIds.length ? { solutionId: { in: solutionIds } } : null,
            ),
          },
          orderBy: { id: "asc" },
        })
      : [];

  const inspectionImages = inspectionIds.length
    ? await prisma.inspectionImage.findMany({
        where: { inspectionId: { in: inspectionIds } },
        orderBy: { id: "asc" },
      })
    : [];

  const deviceMorphoRepairs = taskItemIds.length || inspectionIds.length
    ? await prisma.deviceMorphoRepair.findMany({
        where: {
          OR: or(
            taskItemIds.length ? { taskItemId: { in: taskItemIds } } : null,
            inspectionIds.length ? { inspectionId: { in: inspectionIds } } : null,
          ),
        },
        orderBy: { id: "asc" },
      })
    : [];
  const morphoIds = ids(deviceMorphoRepairs);

  const deviceReplacements = taskItemIds.length || inspectionIds.length
    ? await prisma.deviceReplacement.findMany({
        where: {
          OR: or(
            taskItemIds.length ? { taskItemId: { in: taskItemIds } } : null,
            inspectionIds.length ? { inspectionId: { in: inspectionIds } } : null,
          ),
        },
        orderBy: { id: "asc" },
      })
    : [];
  const replacementIds = ids(deviceReplacements);

  const technicianActivityLogs =
    taskIds.length || taskItemIds.length || inspectionIds.length || morphoIds.length || replacementIds.length
      ? await prisma.technicianActivityLog.findMany({
          where: {
            OR: or(
              taskIds.length ? { taskId: { in: taskIds } } : null,
              taskItemIds.length ? { taskItemId: { in: taskItemIds } } : null,
              inspectionIds.length ? { inspectionId: { in: inspectionIds } } : null,
              morphoIds.length ? { morphoRepairId: { in: morphoIds } } : null,
              replacementIds.length ? { replacementId: { in: replacementIds } } : null,
            ),
          },
          orderBy: { id: "asc" },
        })
      : [];

  const candidateCampaignIds = nums(inspectionTasks.map((x) => x.campaignId));
  const inspectionCampaigns = candidateCampaignIds.length
    ? await prisma.inspectionCampaign.findMany({
        where: {
          id: { in: candidateCampaignIds },
          tasks: { none: { id: { notIn: taskIds } } },
        },
        orderBy: { id: "asc" },
      })
    : [];

  const problemTickets = await prisma.problemTicket.findMany({ orderBy: { id: "asc" } });

  const deviceIds = nums([
    ...inspectionTasks.map((x) => x.deviceId),
    ...inspectionTaskItems.map((x) => x.deviceId),
    ...inspections.map((x) => x.deviceId),
  ]);
  const gateIds = nums([
    ...inspectionTasks.map((x) => x.gateId),
    ...inspectionTaskItems.map((x) => x.gateId),
    ...inspections.map((x) => x.gateId),
  ]);
  const glassIds = nums([
    ...inspectionTasks.map((x) => x.glassId),
    ...inspectionTaskItems.map((x) => x.glassId),
    ...inspections.map((x) => x.glassId),
  ]);

  const affectedDevices = deviceIds.length
    ? await prisma.device.findMany({ where: { id: { in: deviceIds } }, orderBy: { id: "asc" } })
    : [];
  const affectedGates = gateIds.length
    ? await prisma.gate.findMany({ where: { id: { in: gateIds } }, orderBy: { id: "asc" } })
    : [];
  const affectedGlasses = glassIds.length
    ? await prisma.glass.findMany({ where: { id: { in: glassIds } }, orderBy: { id: "asc" } })
    : [];

  return {
    meta: {
      createdAt: new Date().toISOString(),
      globalTaskKinds: GLOBAL_KINDS,
      note: "Backup before clearing test Global Tasks, issue catalog/solutions, and ProblemTicket rows.",
    },
    data: {
      inspectionCampaigns,
      inspectionTasks,
      inspectionTaskItems,
      inspections,
      inspectionImages,
      inspectionIssues,
      inspectionIssueSolutionActions,
      deviceMorphoRepairs,
      deviceReplacements,
      technicianActivityLogs,
      issueCategories,
      issues,
      issueSolutions,
      problemTickets,
      affectedDevices,
      affectedGates,
      affectedGlasses,
    },
  };
}

function printCounts(backup) {
  console.log("\nRows included in backup:");
  for (const [name, rows] of Object.entries(backup.data)) {
    console.log(`- ${name}: ${Array.isArray(rows) ? rows.length : 0}`);
  }
  console.log("\nDevice/Gate/Glass snapshots are reference-only and will NOT be deleted.");
}

async function clear(backup) {
  const d = backup.data;
  return prisma.$transaction(async (tx) => {
    const result = {};
    const del = async (name, model, rows) => {
      const rowIds = ids(rows);
      result[name] = rowIds.length
        ? await model.deleteMany({ where: { id: { in: rowIds } } })
        : { count: 0 };
    };

    await del("solutionActions", tx.inspectionIssueSolutionAction, d.inspectionIssueSolutionActions);
    await del("inspectionIssues", tx.inspectionIssue, d.inspectionIssues);
    await del("inspectionImages", tx.inspectionImage, d.inspectionImages);
    await del("activityLogs", tx.technicianActivityLog, d.technicianActivityLogs);
    await del("morphoRepairs", tx.deviceMorphoRepair, d.deviceMorphoRepairs);
    await del("deviceReplacements", tx.deviceReplacement, d.deviceReplacements);
    await del("taskItems", tx.inspectionTaskItem, d.inspectionTaskItems);
    await del("inspections", tx.inspection, d.inspections);
    await del("tasks", tx.inspectionTask, d.inspectionTasks);

    const campaignIds = ids(d.inspectionCampaigns);
    result.campaigns = campaignIds.length
      ? await tx.inspectionCampaign.deleteMany({
          where: { id: { in: campaignIds }, tasks: { none: {} } },
        })
      : { count: 0 };

    await del("issueSolutions", tx.issueSolution, d.issueSolutions);
    await del("issues", tx.issue, d.issues);
    await del("issueCategories", tx.issueCategory, d.issueCategories);
    await del("problemTickets", tx.problemTicket, d.problemTickets);

    return result;
  }, { maxWait: 10000, timeout: 120000 });
}

async function main() {
  const backup = await collect();
  printCounts(backup);

  const dir = path.resolve(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `smartit-test-data-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), "utf8");

  console.log(`\nBackup saved:\n${file}`);

  if (!process.argv.includes("--clear")) {
    console.log("\nNothing was deleted.");
    console.log("Review the backup, then run the same script with --clear.");
    return;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`\nType exactly "${CONFIRM}" to continue: `);
  rl.close();

  if (answer.trim() !== CONFIRM) {
    console.log("\nConfirmation did not match. Nothing was deleted.");
    return;
  }

  const result = await clear(backup);
  console.log("\nDeleted inside one transaction:");
  for (const [name, value] of Object.entries(result)) {
    console.log(`- ${name}: ${value.count}`);
  }
  console.log(`\nBackup kept at:\n${file}`);
}

main()
  .catch((error) => {
    console.error("\nFAILED. The delete transaction was rolled back.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });