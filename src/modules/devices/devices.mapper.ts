export class DevicesMapper {
  static toResponse(device: any) {
    if (!device) return null;

    return {
      id: device.id,

      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      barcode: device.barcode,
      serialNumber: device.serialNumber,

      manufacturer: device.manufacturer,
      modelNumber: device.modelNumber,

      currentStatus: device.currentStatus,
      installDate: device.installDate,
      lastInspectionAt: device.lastInspectionAt,

      notes: device.notes,

      excelDate: device.excelDate,
      excelStatus: device.excelStatus,
      firmware: device.firmware,
      ipAddress: device.ipAddress,

      createdAt: device.createdAt,
      updatedAt: device.updatedAt,

      deviceType: device.deviceType
        ? {
            id: device.deviceType.id,
            name: device.deviceType.name,
            description: device.deviceType.description,
            createdAt: device.deviceType.createdAt,
            updatedAt: device.deviceType.updatedAt,
          }
        : null,

      location: device.location
        ? {
            id: device.location.id,
            cluster: device.location.cluster,
            building: device.location.building,
            zone: device.location.zone,
            lane: device.location.lane,
            direction: device.location.direction,
            type: device.location.type,
            excelId: device.location.excelId,
            createdAt: device.location.createdAt,
            updatedAt: device.location.updatedAt,
          }
        : null,

      inspections: Array.isArray(device.inspections)
        ? device.inspections.map((inspection: any) =>
            DevicesMapper.inspectionToResponse(inspection),
          )
        : [],

      tasks: Array.isArray(device.tasks)
        ? device.tasks.map((task: any) => DevicesMapper.taskToResponse(task))
        : [],

      maintenanceLogs: Array.isArray(device.maintenanceLogs)
        ? device.maintenanceLogs.map((log: any) =>
            DevicesMapper.maintenanceLogToResponse(log),
          )
        : [],

      statusHistory: Array.isArray(device.statusHistory)
        ? device.statusHistory.map((history: any) =>
            DevicesMapper.statusHistoryToResponse(history),
          )
        : [],

      movements: Array.isArray(device.movements)
        ? device.movements.map((movement: any) =>
            DevicesMapper.movementToResponse(movement),
          )
        : [],
    };
  }

  private static inspectionToResponse(inspection: any) {
    return {
      id: inspection.id,

      deviceId: inspection.deviceId,
      technicianId: inspection.technicianId,
      taskId: inspection.taskId,

      inspectionStatus: inspection.inspectionStatus,
      issueReason: inspection.issueReason,
      notes: inspection.notes,

      latitude: inspection.latitude,
      longitude: inspection.longitude,
      locationText: inspection.locationText,

      inspectedAt: inspection.inspectedAt,
      createdAt: inspection.createdAt,
      updatedAt: inspection.updatedAt,

      technician: inspection.technician
        ? DevicesMapper.userToSmallResponse(inspection.technician)
        : null,

      images: Array.isArray(inspection.images)
        ? inspection.images.map((image: any) => ({
            id: image.id,
            inspectionId: image.inspectionId,
            imageUrl: image.imageUrl,
            imageType: image.imageType,
            createdAt: image.createdAt,
          }))
        : [],

      inspectionIssues: Array.isArray(inspection.inspectionIssues)
        ? inspection.inspectionIssues.map((inspectionIssue: any) =>
            DevicesMapper.inspectionIssueToResponse(inspectionIssue),
          )
        : [],

      solutionActions: Array.isArray(inspection.solutionActions)
        ? inspection.solutionActions.map((action: any) =>
            DevicesMapper.solutionActionToResponse(action),
          )
        : [],
    };
  }

  private static inspectionIssueToResponse(inspectionIssue: any) {
    return {
      id: inspectionIssue.id,

      inspectionId: inspectionIssue.inspectionId,
      issueId: inspectionIssue.issueId,
      reportedById: inspectionIssue.reportedById,

      status: inspectionIssue.status,
      notes: inspectionIssue.notes,
      resolvedAt: inspectionIssue.resolvedAt,
      unresolvedReason: inspectionIssue.unresolvedReason,

      createdAt: inspectionIssue.createdAt,
      updatedAt: inspectionIssue.updatedAt,

      issue: inspectionIssue.issue
        ? DevicesMapper.issueToResponse(inspectionIssue.issue)
        : null,

      reportedBy: inspectionIssue.reportedBy
        ? DevicesMapper.userToSmallResponse(inspectionIssue.reportedBy)
        : null,
    };
  }

  private static issueToResponse(issue: any) {
    return {
      id: issue.id,

      issueCode: issue.issueCode,
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      status: issue.status,

      categoryId: issue.categoryId,
      deviceTypeId: issue.deviceTypeId,

      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,

      category: issue.category
        ? {
            id: issue.category.id,
            name: issue.category.name,
            code: issue.category.code,
            description: issue.category.description,
          }
        : null,

      deviceType: issue.deviceType
        ? {
            id: issue.deviceType.id,
            name: issue.deviceType.name,
            description: issue.deviceType.description,
          }
        : null,

      solutions: Array.isArray(issue.solutions)
        ? issue.solutions.map((solution: any) =>
            DevicesMapper.issueSolutionToResponse(solution),
          )
        : [],
    };
  }

  private static issueSolutionToResponse(solution: any) {
    return {
      id: solution.id,

      solutionCode: solution.solutionCode,
      issueId: solution.issueId,

      title: solution.title,
      description: solution.description,
      stepOrder: solution.stepOrder,
      isRequired: solution.isRequired,
      status: solution.status,

      createdAt: solution.createdAt,
      updatedAt: solution.updatedAt,
    };
  }

  private static solutionActionToResponse(action: any) {
    return {
      id: action.id,

      inspectionId: action.inspectionId,
      inspectionIssueId: action.inspectionIssueId,
      solutionId: action.solutionId,
      technicianId: action.technicianId,

      status: action.status,
      note: action.note,
      doneAt: action.doneAt,

      createdAt: action.createdAt,
      updatedAt: action.updatedAt,

      solution: action.solution
        ? DevicesMapper.issueSolutionToResponse(action.solution)
        : null,

      technician: action.technician
        ? DevicesMapper.userToSmallResponse(action.technician)
        : null,
    };
  }

  private static taskToResponse(task: any) {
    return {
      id: task.id,

      deviceId: task.deviceId,
      assignedToId: task.assignedToId,
      createdById: task.createdById,

      scheduledDate: task.scheduledDate,
      frequency: task.frequency,
      status: task.status,
      notes: task.notes,

      createdAt: task.createdAt,
      updatedAt: task.updatedAt,

      assignedTo: task.assignedTo
        ? DevicesMapper.userToSmallResponse(task.assignedTo)
        : null,

      createdBy: task.createdBy
        ? DevicesMapper.userToSmallResponse(task.createdBy)
        : null,
    };
  }

  private static maintenanceLogToResponse(log: any) {
    return {
      id: log.id,

      deviceId: log.deviceId,
      createdById: log.createdById,

      status: log.status,
      issueReason: log.issueReason,
      notes: log.notes,

      sentOut: log.sentOut,
      maintenancePlace: log.maintenancePlace,
      externalVendor: log.externalVendor,

      startedAt: log.startedAt,
      completedAt: log.completedAt,

      createdAt: log.createdAt,
      updatedAt: log.updatedAt,

      createdBy: log.createdBy
        ? DevicesMapper.userToSmallResponse(log.createdBy)
        : null,
    };
  }

  private static statusHistoryToResponse(history: any) {
    return {
      id: history.id,

      deviceId: history.deviceId,
      oldStatus: history.oldStatus,
      newStatus: history.newStatus,
      changedById: history.changedById,
      note: history.note,
      changedAt: history.changedAt,

      changedBy: history.changedBy
        ? DevicesMapper.userToSmallResponse(history.changedBy)
        : null,
    };
  }

  private static movementToResponse(movement: any) {
    return {
      id: movement.id,

      deviceId: movement.deviceId,
      movedById: movement.movedById,

      movementType: movement.movementType,

      fromLocationId: movement.fromLocationId,
      toLocationId: movement.toLocationId,

      fromText: movement.fromText,
      toText: movement.toText,

      reason: movement.reason,

      movedAt: movement.movedAt,
      createdAt: movement.createdAt,

      movedBy: movement.movedBy
        ? DevicesMapper.userToSmallResponse(movement.movedBy)
        : null,
    };
  }

  private static userToSmallResponse(user: any) {
    return {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: user.jobTitle,
      region: user.region,
      officeNumber: user.officeNumber,
      isActive: user.isActive,
      status: user.status,
    };
  }
}