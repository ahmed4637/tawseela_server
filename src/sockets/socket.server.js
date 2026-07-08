const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const Account = require("../models/account.model");
const DriverProfile = require("../models/driverProfile.model");
const DriverVehicle = require("../models/driverVehicle.model");
const ServiceRequest = require("../models/serviceRequest.model");
const {
  getRoomForRequest,
  ensureChatRoomAccess,
  createChatMessage,
  markRoomMessagesAsRead,
} = require("../services/chat.service");
const {
  assertNoActiveRestriction,
  getActiveRestrictions,
} = require("../services/penalty.service");
const { updateDriverLiveLocation } = require("../services/tracking.service");

let ioInstance = null;

const isDevelopment = process.env.NODE_ENV === "development";

const getFirstHeaderValue = (value) => {
  if (!value) return "";

  if (Array.isArray(value)) {
    return value[0]?.toString().split(",")[0].trim() || "";
  }

  return value.toString().split(",")[0].trim();
};

const getSocketToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token;
  const headerToken =
    getFirstHeaderValue(socket.handshake.headers?.authorization) ||
    getFirstHeaderValue(socket.handshake.headers?.Authorization);

  return (authToken || queryToken || headerToken || "")
    .toString()
    .replace(/^Bearer\s+/i, "")
    .trim();
};

const isValidObjectId = (value) => {
  return mongoose.Types.ObjectId.isValid(value?.toString() || "");
};

const getIO = () => {
  if (!ioInstance) {
    throw new Error("Socket.io لم يتم تشغيله بعد");
  }

  return ioInstance;
};

const getAccountRoom = (accountId) => {
  return `account:${accountId}`;
};

const getRequestRoom = (requestId) => {
  return `request:${requestId}`;
};

const getVehicleRoom = (vehicleTypeCode) => {
  return `vehicle:${vehicleTypeCode}`;
};

const getChatRoom = (roomId) => {
  return `chat:${roomId}`;
};

const normalizeSocketEventName = (eventName) => {
  if (!eventName) return "";

  return eventName
    .toString()
    .trim()
    .replace(/:/g, ".")
    .replace(/-/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
};

const STATIC_EVENT_ALIASES = Object.freeze({
  "socket:connected": ["socket.connected"],

  "request:created": ["request.created", "customer.request.created"],
  "request:new": ["request.available", "driver.request.available"],
  "request:dispatched": ["request.dispatched", "scheduled_ride.request.dispatched"],
  "request:expired": ["request.expired"],
  "request:closed": ["request.closed"],
  "request:removed": ["request.removed_from_driver"],
  "request:confirmed": ["request.accepted", "trip.created", "trip.accepted"],
  "request:status-changed": ["request.status.changed", "trip.status.changed"],

  "offer:new": ["offer.created", "offer.received"],
  "offer:accepted": ["offer.accepted"],
  "offer:closed": ["offer.closed"],
  "offer:countered": ["negotiation.countered", "negotiation.message.created"],
  "offer:rejected": ["offer.rejected"],
  "offer:counter-rejected": ["negotiation.rejected"],

  "chat:room-created": ["chat.room.created"],
  "chat:message-new": ["chat.message.received", "chat.message.created"],
  "chat:messages-read": ["chat.message.read"],

  "driver:online-status-changed": ["driver.online.status_changed"],
  "driver:review-updated": ["driver.review.updated"],
  "driver:location-updated": ["location.driver.updated", "tracking.location.updated"],

  "notification:new": ["notification.created"],

  "safety:incident-created": ["safety.incident.created", "admin.safety.incident.created"],
  "safety:incident-updated": ["safety.incident.updated", "admin.safety.incident.updated"],
});

const REQUEST_STATUS_EVENT_ALIASES = Object.freeze({
  driver_arriving: ["trip.driver_on_way"],
  arrived_to_pickup: ["trip.driver_arrived"],
  in_progress: ["trip.started"],
  completed: ["trip.completed"],
  cancelled_by_customer: ["request.cancelled", "trip.cancelled"],
  cancelled_by_driver: ["request.cancelled", "trip.cancelled"],
  cancelled_by_admin: ["request.cancelled", "trip.cancelled"],
  driver_no_show: ["request.no_show", "trip.driver_no_show"],
  customer_no_show: ["request.no_show", "trip.customer_no_show"],
  expired: ["request.expired"],
});

const getRequestFromPayload = (payload = {}) => {
  return payload.request || payload.doc || payload.serviceRequest || null;
};

const getDynamicEventAliases = (eventName, payload = {}) => {
  const aliases = [];
  const request = getRequestFromPayload(payload);
  const status = payload.status || request?.status;

  if (eventName === "request:status-changed" && status) {
    aliases.push(...(REQUEST_STATUS_EVENT_ALIASES[status] || []));
  }

  if (request?.serviceType === "delivery_order") {
    const deliveryDetails = request.deliveryDetails || {};

    if (
      eventName === "request:status-changed" &&
      status === "in_progress" &&
      deliveryDetails.pickupStatus === "picked_up"
    ) {
      aliases.push("delivery.pickup.confirmed", "delivery.order.picked_up");
    }

    if (
      eventName === "request:status-changed" &&
      status === "completed" &&
      deliveryDetails.deliveryStatus === "delivered"
    ) {
      aliases.push("delivery.delivered", "delivery.order.completed");
    }
  }

  if (request?.serviceType === "scheduled_ride") {
    if (eventName === "request:created" || eventName === "request:new") {
      aliases.push("scheduled_ride.request.created", "scheduled_ride.request.available");
    }

    if (eventName === "request:confirmed") {
      aliases.push("scheduled_ride.request.accepted", "scheduled_ride.trip.scheduled");
    }
  }

  return aliases;
};

const getEventNamesToEmit = (eventName, payload) => {
  const original = eventName?.toString().trim();

  if (!original) {
    return [];
  }

  const normalized = normalizeSocketEventName(original);
  const aliases = [
    original,
    normalized,
    ...(STATIC_EVENT_ALIASES[original] || []),
    ...getDynamicEventAliases(original, payload),
  ].filter(Boolean);

  return [...new Set(aliases)];
};

const emitToRoom = (roomName, eventName, payload) => {
  const eventNames = getEventNamesToEmit(eventName, payload);

  for (const name of eventNames) {
    getIO().to(roomName).emit(name, payload);
  }

  return eventNames;
};

const emitToAccount = (accountId, eventName, payload) => {
  return emitToRoom(getAccountRoom(accountId), eventName, payload);
};

const emitToRequest = (requestId, eventName, payload) => {
  return emitToRoom(getRequestRoom(requestId), eventName, payload);
};

const emitToVehicle = (vehicleTypeCode, eventName, payload) => {
  return emitToRoom(getVehicleRoom(vehicleTypeCode), eventName, payload);
};

const emitToAdmins = (eventName, payload) => {
  return emitToRoom("admins", eventName, payload);
};

const authenticateSocket = async (socket, next) => {
  try {
    const cleanToken = getSocketToken(socket);

    if (!cleanToken) {
      return next(new Error("Token مطلوب للاتصال"));
    }

    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    const accountId = decoded.accountId || decoded.userId;

    if (!accountId) {
      return next(new Error("Token غير صحيح"));
    }

    const account = await Account.findById(accountId);

    if (!account || !account.isActive) {
      return next(new Error("الحساب غير موجود أو غير مفعل"));
    }

    socket.account = account;
    socket.accountId = account._id.toString();
    socket.roles = account.roles || [];
    socket.role = decoded.role || account.defaultRole;

    return next();
  } catch (error) {
    return next(new Error("غير مصرح بالاتصال"));
  }
};

const clearDriverVehicleRooms = (socket) => {
  const rooms = Array.from(socket.rooms);

  for (const room of rooms) {
    if (room.startsWith("vehicle:")) {
      socket.leave(room);
    }
  }
};

const joinDriverVehicleRooms = async (socket) => {
  if (!socket.roles.includes("driver")) {
    return [];
  }

  clearDriverVehicleRooms(socket);

  const vehicleQuery = {
    accountId: socket.accountId,
    isActive: true,
  };

  vehicleQuery.isApproved = true;
  vehicleQuery.reviewStatus = "approved";

  const driverVehicles = await DriverVehicle.find(vehicleQuery);

  const vehicleCodes = [
    ...new Set(
      driverVehicles.map((vehicle) => vehicle.vehicleTypeCode).filter(Boolean),
    ),
  ];

  for (const code of vehicleCodes) {
    socket.join(getVehicleRoom(code));
  }

  return vehicleCodes;
};

const canJoinRequestRoom = async ({ socket, requestId }) => {
  if (!isValidObjectId(requestId)) {
    return false;
  }

  const request = await ServiceRequest.findById(requestId);

  if (!request) {
    return false;
  }

  const isCustomer = request.customerAccountId.toString() === socket.accountId;

  const isAcceptedDriver =
    request.acceptedDriverAccountId?.toString() === socket.accountId;

  const isAdmin = socket.roles.includes("admin");

  if (isCustomer || isAcceptedDriver || isAdmin) {
    return true;
  }

  const isOpenForDrivers =
    socket.roles.includes("driver") &&
    request.customerAccountId.toString() !== socket.accountId &&
    ["pending_offers", "negotiating"].includes(request.status);

  if (!isOpenForDrivers) {
    return false;
  }

  const driverProfile = await DriverProfile.findOne({
    accountId: socket.accountId,
  });

  if (!driverProfile) {
    return false;
  }

  driverProfile.refreshDebtBlockStatus();

  const activeRestrictions = await getActiveRestrictions({
    accountId: socket.accountId,
    restrictionTypes: ["app_usage", "driver_online", "receiving_requests"],
  });

  if (activeRestrictions.length > 0) {
    return false;
  }

  if (
    !driverProfile.isActive ||
    !driverProfile.isOnline ||
    !driverProfile.isAvailable ||
    driverProfile.isBlockedForDebt ||
    driverProfile.activeServiceRequestId ||
    driverProfile.commissionDebt >= driverProfile.commissionDebtLimit
  ) {
    return false;
  }

  if (
    !driverProfile.isApproved ||
    driverProfile.reviewStatus !== "approved"
  ) {
    return false;
  }

  const vehicleQuery = {
    accountId: socket.accountId,
    isActive: true,
    vehicleTypeCode: request.vehicleTypeCode,
  };

  vehicleQuery.isApproved = true;
  vehicleQuery.reviewStatus = "approved";

  const matchingVehicle = await DriverVehicle.exists(vehicleQuery);

  return !!matchingVehicle;
};

const initSocketServer = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    },
  });

  ioInstance.use(authenticateSocket);

  ioInstance.on("connection", async (socket) => {
    console.log(`Socket connected: ${socket.accountId}`);

    let lastDriverLocationDbSaveAt = 0;

    socket.join(getAccountRoom(socket.accountId));

    if (socket.roles.includes("admin")) {
      socket.join("admins");
    }

    if (socket.roles.includes("driver")) {
      socket.join("drivers");

      const driverProfile = await DriverProfile.findOne({
        accountId: socket.accountId,
      });

      if (driverProfile?.isOnline) {
        socket.join("online_drivers");
        await joinDriverVehicleRooms(socket);
      }
    }

    const connectedPayload = {
      success: true,
      message: "تم الاتصال باللايف بنجاح",
      accountId: socket.accountId,
      roles: socket.roles,
    };

    for (const eventName of getEventNamesToEmit("socket:connected", connectedPayload)) {
      socket.emit(eventName, connectedPayload);
    }

    socket.on("request:join", async (payload = {}, callback) => {
      try {
        const requestId = (
          payload.requestId ||
          payload.serviceRequestId ||
          payload.rideId ||
          ""
        )
          .toString()
          .trim();

        if (!requestId) {
          throw new Error("رقم الطلب مطلوب");
        }

        const allowed = await canJoinRequestRoom({
          socket,
          requestId,
        });

        if (!allowed) {
          throw new Error("غير مسموح لك بمتابعة هذا الطلب");
        }

        socket.join(getRequestRoom(requestId));

        if (callback) {
          callback({
            success: true,
            message: "تم الدخول إلى غرفة الطلب",
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("request:leave", (payload = {}, callback) => {
      const requestId = (
        payload.requestId ||
        payload.serviceRequestId ||
        payload.rideId ||
        ""
      )
        .toString()
        .trim();

      if (requestId) {
        socket.leave(getRequestRoom(requestId));
      }

      if (callback) {
        callback({
          success: true,
          message: "تم الخروج من غرفة الطلب",
        });
      }
    });

    socket.on("chat:join", async (payload = {}, callback) => {
      try {
        const roomId = (payload.roomId || "").toString().trim();
        const serviceRequestId = (
          payload.serviceRequestId ||
          payload.requestId ||
          payload.rideId ||
          ""
        )
          .toString()
          .trim();

        let room = null;

        if (roomId) {
          room = await ensureChatRoomAccess({
            roomId,
            accountId: socket.accountId,
            roles: socket.roles || [],
          });
        } else if (serviceRequestId) {
          room = await getRoomForRequest({
            serviceRequestId,
            accountId: socket.accountId,
            roles: socket.roles || [],
          });
        } else {
          throw new Error("رقم غرفة الشات أو الطلب مطلوب");
        }

        socket.join(getChatRoom(room._id));

        if (callback) {
          callback({
            success: true,
            message: "تم الدخول إلى غرفة الشات",
            room,
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("chat:leave", (payload = {}, callback) => {
      const roomId = (payload.roomId || "").toString().trim();

      if (roomId) {
        socket.leave(getChatRoom(roomId));
      }

      if (callback) {
        callback({
          success: true,
          message: "تم الخروج من غرفة الشات",
        });
      }
    });

    socket.on("chat:send", async (payload = {}, callback) => {
      try {
        const roomId = (payload.roomId || "").toString().trim();

        if (!roomId) {
          throw new Error("رقم غرفة الشات مطلوب");
        }

        const { room, message } = await createChatMessage({
          roomId,
          senderAccountId: socket.accountId,
          messageType: payload.messageType,
          text: payload.text,
          mediaUrl: payload.mediaUrl,
          location: payload.location,
        });

        const receiverId = (
          message.receiverAccountId?._id || message.receiverAccountId || ""
        ).toString();

        const chatPayload = {
          room,
          message,
          serviceRequestId: room.serviceRequestId,
          requestId: room.serviceRequestId,
        };

        ioInstance.to(getChatRoom(room._id)).emit("chat:message-new", chatPayload);
        emitToRequest(room.serviceRequestId.toString(), "chat:message-new", chatPayload);

        if (receiverId) {
          emitToAccount(receiverId, "chat:message-new", chatPayload);
        }

        emitToAdmins("admin:chat-message-new", chatPayload);

        if (receiverId) {
          setImmediate(async () => {
            try {
              const { createNotification } = require("../services/notification.service");
              await createNotification({
                accountId: receiverId,
                title: "رسالة جديدة",
                body:
                  message.messageType === "text"
                    ? message.text
                    : "وصلك محتوى جديد في الشات",
                type: "chat",
                data: {
                  roomId: room._id,
                  serviceRequestId: room.serviceRequestId,
                  requestId: room.serviceRequestId,
                  messageId: message._id,
                },
              });
            } catch (error) {
              console.error("Socket chat notification error:", error.message);
            }
          });
        }

        if (callback) {
          callback({
            success: true,
            message: "تم إرسال الرسالة بنجاح",
            doc: message,
            room,
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("chat:read", async (payload = {}, callback) => {
      try {
        const roomId = (payload.roomId || "").toString().trim();

        if (!roomId) {
          throw new Error("رقم غرفة الشات مطلوب");
        }

        const { room, modifiedCount } = await markRoomMessagesAsRead({
          roomId,
          accountId: socket.accountId,
          roles: socket.roles || [],
        });

        const readPayload = {
          roomId: room._id,
          serviceRequestId: room.serviceRequestId,
          readerAccountId: socket.accountId,
          modifiedCount,
        };

        ioInstance.to(getChatRoom(room._id)).emit("chat:messages-read", readPayload);
        emitToRequest(room.serviceRequestId.toString(), "chat:messages-read", readPayload);

        if (callback) {
          callback({
            success: true,
            message: "تم تعليم رسائل الشات كمقروءة",
            modifiedCount,
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("driver:go-online", async (payload = {}, callback) => {
      try {
        if (!socket.roles.includes("driver")) {
          throw new Error("هذا الإجراء متاح للسائق فقط");
        }

        const { lat, lng } = payload;

        const hasLocation = lat !== undefined || lng !== undefined;
        const latNumber = Number(lat);
        const lngNumber = Number(lng);

        if (
          hasLocation &&
          (!Number.isFinite(latNumber) || !Number.isFinite(lngNumber))
        ) {
          throw new Error("الموقع غير صحيح");
        }

        const driverProfile = await DriverProfile.findOne({
          accountId: socket.accountId,
        });

        if (!driverProfile) {
          throw new Error("ملف السائق غير موجود");
        }

        await assertNoActiveRestriction({
          accountId: socket.accountId,
          restrictionTypes: ["app_usage", "driver_online", "receiving_requests"],
        });

        if (!driverProfile.isApproved || driverProfile.reviewStatus !== "approved") {
          throw new Error("حساب السائق لم تتم الموافقة عليه بعد");
        }

        const approvedVehicleCount = await DriverVehicle.countDocuments({
          accountId: socket.accountId,
          isActive: true,
          isApproved: true,
          reviewStatus: "approved",
        });

        if (approvedVehicleCount === 0) {
          throw new Error("لا يمكن فتح Online قبل اعتماد مركبة واحدة على الأقل");
        }

        driverProfile.refreshDebtBlockStatus();

        if (
          driverProfile.isBlockedForDebt ||
          Number(driverProfile.commissionDebt || 0) >= Number(driverProfile.commissionDebtLimit || 0)
        ) {
          driverProfile.isBlockedForDebt = true;
          driverProfile.blockedReason = driverProfile.blockedReason ||
            "تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق";
          driverProfile.isOnline = false;
          driverProfile.isAvailable = false;
          await driverProfile.save();

          throw new Error(driverProfile.blockedReason);
        }

        driverProfile.isOnline = true;
        driverProfile.isAvailable = !driverProfile.activeServiceRequestId;
        driverProfile.lastOnlineAt = new Date();

        if (hasLocation) {
          driverProfile.currentLat = latNumber;
          driverProfile.currentLng = lngNumber;
          driverProfile.currentLocation = {
            type: "Point",
            coordinates: [lngNumber, latNumber],
          };
        }

        await driverProfile.save();

        socket.join("online_drivers");

        const vehicleCodes = await joinDriverVehicleRooms(socket);

        if (callback) {
          callback({
            success: true,
            message: "السائق أصبح Online",
            driverProfile,
            vehicleCodes,
          });
        }

        const onlinePayload = {
          accountId: socket.accountId,
          isOnline: true,
          isAvailable: driverProfile.isAvailable,
          currentLat: driverProfile.currentLat,
          currentLng: driverProfile.currentLng,
          vehicleCodes,
          driverProfile,
        };

        for (const eventName of getEventNamesToEmit("driver:online-status-changed", onlinePayload)) {
          socket.emit(eventName, onlinePayload);
        }
        emitToAdmins("driver:online-status-changed", onlinePayload);
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("driver:go-offline", async (payload = {}, callback) => {
      try {
        if (!socket.roles.includes("driver")) {
          throw new Error("هذا الإجراء متاح للسائق فقط");
        }

        const driverProfile = await DriverProfile.findOne({
          accountId: socket.accountId,
        });

        if (!driverProfile) {
          throw new Error("ملف السائق غير موجود");
        }

        driverProfile.isOnline = false;
        driverProfile.isAvailable = false;
        await driverProfile.save();

        socket.leave("online_drivers");
        clearDriverVehicleRooms(socket);

        if (callback) {
          callback({
            success: true,
            message: "السائق أصبح Offline",
            driverProfile,
          });
        }

        const offlinePayload = {
          accountId: socket.accountId,
          isOnline: false,
          isAvailable: false,
          currentLat: driverProfile.currentLat,
          currentLng: driverProfile.currentLng,
          vehicleCodes: [],
          driverProfile,
        };

        for (const eventName of getEventNamesToEmit("driver:online-status-changed", offlinePayload)) {
          socket.emit(eventName, offlinePayload);
        }
        emitToAdmins("driver:online-status-changed", offlinePayload);
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("driver:location", async (payload = {}, callback) => {
      try {
        if (!socket.roles.includes("driver")) {
          throw new Error("هذا الإجراء متاح للسائق فقط");
        }

        const requestIdFromPayload = (
          payload.requestId ||
          payload.serviceRequestId ||
          payload.rideId ||
          ""
        )
          .toString()
          .trim();

        const {
          settings,
          locationPayload,
        } = await updateDriverLiveLocation({
          accountId: socket.accountId,
          requestId: requestIdFromPayload,
          lat: payload.lat,
          lng: payload.lng,
          latitude: payload.latitude,
          longitude: payload.longitude,
          speed: payload.speed,
          heading: payload.heading,
          accuracy: payload.accuracy,
          metadata: {
            socketId: socket.id,
            platform: payload.platform || null,
            appVersion: payload.appVersion || null,
          },
        });

        if (locationPayload.serviceRequestId) {
          emitToRequest(
            locationPayload.serviceRequestId,
            "driver:location-updated",
            locationPayload,
          );
        }

        if (settings.adminLiveTrackingEnabled) {
          emitToAdmins("driver:location-updated", {
            ...locationPayload,
            activeServiceRequestId: locationPayload.serviceRequestId,
          });
        }

        if (callback) {
          callback({
            success: true,
            message: "تم تحديث موقع السائق",
            savedToHistory: locationPayload.savedToHistory,
            savedToDriverProfile: locationPayload.savedToDriverProfile,
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.accountId}`);
    });
  });

  return ioInstance;
};

module.exports = {
  initSocketServer,
  getIO,
  getAccountRoom,
  getRequestRoom,
  getVehicleRoom,
  getChatRoom,
  emitToAccount,
  emitToRequest,
  emitToVehicle,
  emitToAdmins,
  emitToRoom,
  getEventNamesToEmit,
};