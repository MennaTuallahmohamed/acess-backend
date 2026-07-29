const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const CONFIRM = "RESTORE TEST DATA";

async function add(model, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { count: 0 };
  return model.createMany({ data: rows });
}

async function main() {
  const relative = process.argv[2];
  if (!relative) {
    throw new Error('Usage: node .\\scripts\\restore-test-data.cjs ".\\backups\\smartit-test-data-....json"');
  }

  const file = path.resolve(process.cwd(), relative);
  if (!fs.existsSync(file)) throw new Error(`Backup not found: ${file}`);

  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  const d = backup.data;
  if (!d) throw new Error("Invalid backup file.");

  console.log(`Backup date: ${backup.meta?.createdAt || "unknown"}`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Type exactly "${CONFIRM}" to restore: `);
  rl.close();
  if (answer.trim() !== CONFIRM) {
    console.log("Nothing was restored.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => ({
    issueCategories: await add(tx.issueCategory, d.issueCategories),
    issues: await add(tx.issue, d.issues),
    issueSolutions: await add(tx.issueSolution, d.issueSolutions),
    campaigns: await add(tx.inspectionCampaign, d.inspectionCampaigns),
    tasks: await add(tx.inspectionTask, d.inspectionTasks),
    inspections: await add(tx.inspection, d.inspections),
    taskItems: await add(tx.inspectionTaskItem, d.inspectionTaskItems),
    inspectionImages: await add(tx.inspectionImage, d.inspectionImages),
    inspectionIssues: await add(tx.inspectionIssue, d.inspectionIssues),
    morphoRepairs: await add(tx.deviceMorphoRepair, d.deviceMorphoRepairs),
    deviceReplacements: await add(tx.deviceReplacement, d.deviceReplacements),
    solutionActions: await add(tx.inspectionIssueSolutionAction, d.inspectionIssueSolutionActions),
    activityLogs: await add(tx.technicianActivityLog, d.technicianActivityLogs),
    problemTickets: await add(tx.problemTicket, d.problemTickets),
  }), { maxWait: 10000, timeout: 120000 });

  console.log("\nRestored:");
  for (const [name, value] of Object.entries(result)) {
    console.log(`- ${name}: ${value.count}`);
  }
}

main()
  .catch((error) => {
    console.error("\nRESTORE FAILED. The transaction was rolled back.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });