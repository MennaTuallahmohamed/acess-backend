const { PrismaClient } = require("@prisma/client");
const readline = require("readline");

const prisma = new PrismaClient();

const TARGET = {
  deviceCode: "852",
  deviceName: "Device 852",
  barcode: "KEEP-DEVICE-852",
  serialNumber: null,
  ipAddress: "10.254.214.117",
  secretCode: "DSC-AEF0-98B7-B963-5922",

  cluster: "13A  14A",
  building: "وزارة الضرائب المصرية",
  zone: "Zone 11  right",
  lane: "2",
  direction: "IN",
  excelId: "KEEP-852-13A14A-Z11RIGHT-L2-IN",
};

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function findConflicts() {
  return prisma.device.findMany({
    where: {
      OR: [
        { deviceCode: TARGET.deviceCode },
        { barcode: TARGET.barcode },
        { secretCode: TARGET.secretCode },
      ],
    },
    include: {
      location: true,
      deviceType: true,
    },
  });
}

async function chooseDeviceType() {
  // First preference: same cluster + zone among existing DEVICE records.
  const nearby = await prisma.$queryRawUnsafe(`
    SELECT
      d."deviceTypeId" AS "deviceTypeId",
      dt."name" AS "name",
      COUNT(*)::int AS "count"
    FROM "Device" d
    JOIN "Location" l ON l."id" = d."locationId"
    JOIN "DeviceType" dt ON dt."id" = d."deviceTypeId"
    WHERE d."assetType"::text = 'DEVICE'
      AND regexp_replace(lower(coalesce(l."cluster", '')), '[^a-z0-9]+', '', 'g') = '13a14a'
      AND regexp_replace(lower(coalesce(l."zone", '')), '[^a-z0-9]+', '', 'g') = 'zone11right'
    GROUP BY d."deviceTypeId", dt."name"
    ORDER BY COUNT(*) DESC, d."deviceTypeId" ASC
  `);

  if (nearby.length === 1) {
    return {
      id: Number(nearby[0].deviceTypeId),
      name: nearby[0].name,
      source: "same cluster + zone",
      nearby,
    };
  }

  if (nearby.length > 1) {
    // If one type clearly dominates, use it only if all nearby rows are that type.
    const total = nearby.reduce((s, r) => s + Number(r.count), 0);
    if (Number(nearby[0].count) === total) {
      return {
        id: Number(nearby[0].deviceTypeId),
        name: nearby[0].name,
        source: "same cluster + zone",
        nearby,
      };
    }

    return { id: null, name: null, source: "ambiguous nearby types", nearby };
  }

  // Fallback: if backend has exactly one DEVICE type, use it.
  const allTypes = await prisma.deviceType.findMany({
    where: { assetType: "DEVICE" },
    orderBy: { id: "asc" },
  });

  if (allTypes.length === 1) {
    return {
      id: allTypes[0].id,
      name: allTypes[0].name,
      source: "only DEVICE type in backend",
      nearby: [],
    };
  }

  return {
    id: null,
    name: null,
    source: "cannot infer device type safely",
    nearby,
    allTypes,
  };
}

async function findLocation() {
  return prisma.location.findFirst({
    where: {
      cluster: TARGET.cluster,
      building: TARGET.building,
      zone: TARGET.zone,
      lane: TARGET.lane,
      direction: TARGET.direction,
    },
  });
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("============================================================");
  console.log(" RESTORE KEEP DEVICE 852");
  console.log(" NO DELETE - NO UPDATE");
  console.log(apply ? " MODE: INSERT ONLY" : " MODE: DRY RUN ONLY");
  console.log("============================================================");
  console.log("");
  console.log(`Device Code : ${TARGET.deviceCode}`);
  console.log(`IP          : ${TARGET.ipAddress}`);
  console.log(`Serial      : NULL`);
  console.log(`Secret Code : ${TARGET.secretCode}`);
  console.log(`Cluster     : ${TARGET.cluster}`);
  console.log(`Building    : ${TARGET.building}`);
  console.log(`Zone        : ${TARGET.zone}`);
  console.log(`Lane        : ${TARGET.lane}`);
  console.log(`Direction   : ${TARGET.direction}`);
  console.log("");

  const conflicts = await findConflicts();

  if (conflicts.length) {
    console.log("------------------------------------------------------------");
    console.log("EXISTING DEVICE CONFLICT / ALREADY PRESENT");
    console.log("------------------------------------------------------------");
    conflicts.forEach((d) => {
      console.log(`Backend ID  : ${d.id}`);
      console.log(`Asset Type  : ${d.assetType}`);
      console.log(`Device Code : ${d.deviceCode}`);
      console.log(`Barcode     : ${d.barcode}`);
      console.log(`IP          : ${d.ipAddress ?? ""}`);
      console.log(`Serial      : ${d.serialNumber ?? ""}`);
      console.log(`Secret Code : ${d.secretCode ?? ""}`);
      console.log("");
    });

    const exact = conflicts.find(
      (d) =>
        d.assetType === "DEVICE" &&
        d.deviceCode === TARGET.deviceCode &&
        d.secretCode === TARGET.secretCode
    );

    if (exact) {
      console.log("✅ Device 852 already exists as DEVICE.");
      console.log("✅ Nothing was inserted.");
      return;
    }

    console.log("❌ STOPPED: unique DeviceCode / Barcode / Secret conflict exists.");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 3;
    return;
  }

  const typeChoice = await chooseDeviceType();

  console.log("DEVICE TYPE CHECK");
  console.log("------------------------------------------------------------");
  if (typeChoice.nearby?.length) {
    typeChoice.nearby.forEach((t) => {
      console.log(
        `Type ID ${t.deviceTypeId} | ${t.name} | nearby count=${t.count}`
      );
    });
  }

  if (!typeChoice.id) {
    console.log("");
    console.log("❌ Cannot infer deviceTypeId safely.");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    process.exitCode = 4;
    return;
  }

  console.log(
    `✅ Will use DeviceType ID ${typeChoice.id} (${typeChoice.name}) [${typeChoice.source}]`
  );
  console.log("");

  const existingLocation = await findLocation();

  if (existingLocation) {
    console.log(`✅ Exact Location already exists. Location ID: ${existingLocation.id}`);
  } else {
    console.log("ℹ️ Exact Location does not exist.");
    console.log("ℹ️ A new Location will be INSERTED for Device 852.");
  }

  if (!apply) {
    console.log("");
    console.log("============================================================");
    console.log(" DRY RUN COMPLETE ✅");
    console.log("============================================================");
    console.log("NO DEVICE WAS INSERTED.");
    console.log("NO LOCATION WAS INSERTED.");
    console.log("NO DELETE / UPDATE OCCURRED.");
    console.log("");
    console.log("To insert Device 852:");
    console.log("  node scripts\\restore-device-852.cjs --apply");
    return;
  }

  console.log("");
  const confirmation = await ask(
    "Type ADD-DEVICE-852 to insert this ONE device: "
  );

  if (confirmation !== "ADD-DEVICE-852") {
    console.log("❌ Cancelled.");
    console.log("✅ NO DATABASE CHANGES WERE MADE.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside transaction.
    const conflict = await tx.device.findFirst({
      where: {
        OR: [
          { deviceCode: TARGET.deviceCode },
          { barcode: TARGET.barcode },
          { secretCode: TARGET.secretCode },
        ],
      },
    });

    if (conflict) {
      throw new Error(
        `Conflict appeared before insert. Backend ID=${conflict.id}, DeviceCode=${conflict.deviceCode}`
      );
    }

    let location = await tx.location.findFirst({
      where: {
        cluster: TARGET.cluster,
        building: TARGET.building,
        zone: TARGET.zone,
        lane: TARGET.lane,
        direction: TARGET.direction,
      },
    });

    let locationCreated = false;

    if (!location) {
      location = await tx.location.create({
        data: {
          cluster: TARGET.cluster,
          building: TARGET.building,
          zone: TARGET.zone,
          lane: TARGET.lane,
          direction: TARGET.direction,
          excelId: TARGET.excelId,
          type: "DEVICE",
        },
      });
      locationCreated = true;
    }

    const device = await tx.device.create({
      data: {
        deviceCode: TARGET.deviceCode,
        deviceName: TARGET.deviceName,
        barcode: TARGET.barcode,
        serialNumber: TARGET.serialNumber,
        ipAddress: TARGET.ipAddress,
        secretCode: TARGET.secretCode,
        assetType: "DEVICE",
        currentStatus: "OK",
        lifecycleStatus: "ACTIVE",
        deviceTypeId: typeChoice.id,
        locationId: location.id,
        notes: "Restored protected KEEP device 852",
      },
      include: {
        location: true,
        deviceType: true,
      },
    });

    return { device, locationCreated };
  });

  console.log("");
  console.log("============================================================");
  console.log(" DEVICE 852 INSERTED ✅");
  console.log("============================================================");
  console.log(`Backend ID  : ${result.device.id}`);
  console.log(`Asset Type  : ${result.device.assetType}`);
  console.log(`Device Code : ${result.device.deviceCode}`);
  console.log(`Device Name : ${result.device.deviceName}`);
  console.log(`Barcode     : ${result.device.barcode}`);
  console.log(`IP          : ${result.device.ipAddress}`);
  console.log(`Serial      : ${result.device.serialNumber ?? ""}`);
  console.log(`Secret Code : ${result.device.secretCode}`);
  console.log(`Device Type : ${result.device.deviceType.name} (${result.device.deviceTypeId})`);
  console.log(`Location ID : ${result.device.locationId}`);
  console.log(`Cluster     : ${result.device.location.cluster}`);
  console.log(`Building    : ${result.device.location.building}`);
  console.log(`Zone        : ${result.device.location.zone}`);
  console.log(`Lane        : ${result.device.location.lane}`);
  console.log(`Direction   : ${result.device.location.direction}`);
  console.log(`New Location: ${result.locationCreated ? "YES" : "NO"}`);
  console.log("");
  console.log("✅ ONLY INSERT(S) OCCURRED.");
  console.log("✅ NO DEVICE WAS DELETED.");
  console.log("✅ NO EXISTING DEVICE WAS UPDATED.");
}

main()
  .catch((err) => {
    console.error("");
    console.error("❌ ERROR:", err.message || err);
    console.error("If the transaction started, it was rolled back.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
