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

const emitToAccount = (accountId, eventName, payload) => {
  getIO().to(getAccountRoom(accountId)).emit(eventName, payload);
};

const emitToRequest = (requestId, eventName, payload) => {
  getIO().to(getRequestRoom(requestId)).emit(eventName, payload);
};

const emitToVehicle = (vehicleTypeCode, eventName, payload) => {
  getIO().to(getVehicleRoom(vehicleTypeCode)).emit(eventName, payload);
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

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = "approved";
  }

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

  if (!isDevelopment) {
    if (
      !driverProfile.isApproved ||
      driverProfile.reviewStatus !== "approved"
    ) {
      return false;
    }
  }

  const vehicleQuery = {
    accountId: socket.accountId,
    isActive: true,
    vehicleTypeCode: request.vehicleTypeCode,
  };

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = "approved";
  }

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

    socket.emit("socket:connected", {
      success: true,
      message: "تم الاتصال باللايف بنجاح",
      accountId: socket.accountId,
      roles: socket.roles,
    });

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

        ioInstance.to("admins").emit("admin:chat-message-new", chatPayload);

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

        if (!isDevelopment) {
          if (!driverProfile.isApproved || driverProfile.reviewStatus !== "approved") {
            throw new Error("حساب السائق لم تتم الموافقة عليه بعد");
          }
        }

        driverProfile.refreshDebtBlockStatus();

        if (driverProfile.isBlockedForDebt) {
          throw new Error(
            driverProfile.blockedReason ||
              "تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق",
          );
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

        socket.emit("driver:online-status-changed", onlinePayload);
        ioInstance.to("admins").emit("driver:online-status-changed", onlinePayload);
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

        socket.emit("driver:online-status-changed", offlinePayload);
        ioInstance.to("admins").emit("driver:online-status-changed", offlinePayload);
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
          ioInstance.to("admins").emit("driver:location-updated", {
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
};