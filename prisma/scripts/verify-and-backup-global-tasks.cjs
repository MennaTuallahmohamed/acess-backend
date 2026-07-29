require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function getArgument(name, fallback = null) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));

  if (!argument) {
    return fallback;
  }

  return argument.slice(prefix.length);
}

function safeDatabaseInfo() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return {
      host: "DATABASE_URL is missing",
      port: "—",
      database: "—",
    };
  }

  try {
    const parsed = new URL(databaseUrl);

    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "") || "—",
    };
  } catch {
    return {
      host: "Could not parse DATABASE_URL",
      port: "—",
      database: "—",
    };
  }
}

function countStatuses(items) {
  return items.reduce((result, item) => {
    const status = String(item.status || "UNKNOWN");

    result[status] = (result[status] || 0) + 1;

    return result;
  }, {});
}

async function findResponsibleUser(requestedUserId) {
  if (requestedUserId) {
    const user = await prisma.user.findUnique({
      where: {
        id: requestedUserId,
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        jobTitle: true,
      },
    });

    if (user) {
      return user;
    }
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      jobTitle: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  const user = users.find((candidate) => {
    const text = [
      candidate.fullName,
      candidate.username,
      candidate.email,
      candidate.jobTitle,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      text.includes("mohamed farag") ||
      text.includes("farag") ||
      text.includes("محمد فرج") ||
      text.includes("فرج")
    );
  });

  if (!user) {
    throw new Error(
      "Mohamed Farag was not found. Run again with --user-id=THE_CORRECT_ID",
    );
  }

  return user;
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log(" SmartIT Global Tasks Verification");
  console.log("========================================");
  console.log("");

  const requestedUserId = Number(getArgument("user-id", "56"));

  const databaseInfo = safeDatabaseInfo();

  console.log("Database host:", databaseInfo.host);
  console.log("Database port:", databaseInfo.port);
  console.log("Database name:", databaseInfo.database);
  console.log("");

  const responsibleUser = await findResponsibleUser(
    Number.isInteger(requestedUserId) && requestedUserId > 0
      ? requestedUserId
      : null,
  );

  console.log(
    "Responsible user:",
    responsibleUser.fullName ||
      responsibleUser.username ||
      responsibleUser.email ||
      `User #${responsibleUser.id}`,
  );

  console.log("User ID:", responsibleUser.id);
  console.log("");

  /*
   * نحصل فقط على المهام المرتبطة بالمستخدم:
   * - المهمة نفسها مسندة إليه
   * أو
   * - أحد عناصر المهمة مسند إليه.
   */
  const tasks = await prisma.inspectionTask.findMany({
    where: {
      OR: [
        {
          assignedToId: responsibleUser.id,
        },
        {
          items: {
            some: {
              assignedToId: responsibleUser.id,
            },
          },
        },
      ],
    },

    include: {
      assignedTo: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          jobTitle: true,
        },
      },

      createdBy: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          jobTitle: true,
        },
      },

      campaign: true,

      device: {
        include: {
          location: true,
          deviceType: true,
        },
      },

      gate: {
        include: {
          location: true,
        },
      },

      glass: {
        include: {
          location: true,
        },
      },

      items: {
        include: {
          assignedTo: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
              jobTitle: true,
            },
          },

          completedBy: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
              jobTitle: true,
            },
          },

          device: {
            include: {
              location: true,
              deviceType: true,
            },
          },

          gate: {
            include: {
              location: true,
            },
          },

          glass: {
            include: {
              location: true,
            },
          },
        },

        orderBy: [
          {
            routeOrder: "asc",
          },
          {
            id: "asc",
          },
        ],
      },
    },

    orderBy: [
      {
        scheduledDate: "desc",
      },
      {
        id: "desc",
      },
    ],
  });

  const allItems = tasks.flatMap((task) => task.items || []);

  const taskStatuses = countStatuses(tasks);
  const itemStatuses = countStatuses(allItems);

  console.log("Global Tasks found:", tasks.length);
  console.log("Assigned Items found:", allItems.length);
  console.log("");

  console.log("Task statuses:");
  console.log(taskStatuses);
  console.log("");

  console.log("Item statuses:");
  console.log(itemStatuses);
  console.log("");

  tasks.forEach((task) => {
    console.log("----------------------------------------");
    console.log("Task ID:", task.id);
    console.log("Title:", task.title || "Untitled Global Task");
    console.log("Status:", task.status);
    console.log("Task Kind:", task.taskKind);
    console.log("Asset Type:", task.assetType);
    console.log("Items:", task.items.length);
    console.log("Scheduled:", task.scheduledDate);
  });

  const backupsDirectory = path.join(
    process.cwd(),
    "backups",
  );

  fs.mkdirSync(backupsDirectory, {
    recursive: true,
  });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const backupPath = path.join(
    backupsDirectory,
    `global-tasks-user-${responsibleUser.id}-${timestamp}.json`,
  );

  const backup = {
    exportedAt: new Date().toISOString(),

    database: databaseInfo,

    responsibleUser,

    summary: {
      globalTasks: tasks.length,
      assignedItems: allItems.length,
      taskStatuses,
      itemStatuses,
    },

    tasks,
  };

  fs.writeFileSync(
    backupPath,
    JSON.stringify(backup, null, 2),
    "utf8",
  );

  console.log("");
  console.log("========================================");
  console.log(" Verification completed successfully");
  console.log("========================================");
  console.log("");
  console.log("Backup created:");
  console.log(backupPath);
  console.log("");
  console.log("Nothing was deleted or modified.");
  console.log("Problems and Solutions were not accessed.");
}

main()
  .catch((error) => {
    console.error("");
    console.error("Global Tasks verification failed.");
    console.error("Nothing was deleted or modified.");
    console.error("");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });