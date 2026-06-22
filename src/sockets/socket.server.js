const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const ServiceRequest = require('../models/serviceRequest.model');

let ioInstance = null;

const isDevelopment = process.env.NODE_ENV === 'development';

const getIO = () => {
  if (!ioInstance) {
    throw new Error('Socket.io لم يتم تشغيله بعد');
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
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      '';

    if (!token) {
      return next(new Error('Token مطلوب للاتصال'));
    }

    const cleanToken = token.toString().replace('Bearer ', '').trim();
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);

    const accountId = decoded.accountId || decoded.userId;

    if (!accountId) {
      return next(new Error('Token غير صحيح'));
    }

    const account = await Account.findById(accountId);

    if (!account || !account.isActive) {
      return next(new Error('الحساب غير موجود أو غير مفعل'));
    }

    socket.account = account;
    socket.accountId = account._id.toString();
    socket.roles = account.roles || [];
    socket.role = decoded.role || account.defaultRole;

    return next();
  } catch (error) {
    return next(new Error('غير مصرح بالاتصال'));
  }
};

const clearDriverVehicleRooms = (socket) => {
  const rooms = Array.from(socket.rooms);

  for (const room of rooms) {
    if (room.startsWith('vehicle:')) {
      socket.leave(room);
    }
  }
};

const joinDriverVehicleRooms = async (socket) => {
  if (!socket.roles.includes('driver')) {
    return [];
  }

  clearDriverVehicleRooms(socket);

  const vehicleQuery = {
    accountId: socket.accountId,
    isActive: true,
  };

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = 'approved';
  }

  const driverVehicles = await DriverVehicle.find(vehicleQuery);

  const vehicleCodes = [
    ...new Set(
      driverVehicles
        .map((vehicle) => vehicle.vehicleTypeCode)
        .filter(Boolean)
    ),
  ];

  for (const code of vehicleCodes) {
    socket.join(getVehicleRoom(code));
  }

  return vehicleCodes;
};

const canJoinRequestRoom = async ({ socket, requestId }) => {
  const request = await ServiceRequest.findById(requestId);

  if (!request) {
    return false;
  }

  const isCustomer = request.customerAccountId.toString() === socket.accountId;

  const isAcceptedDriver =
    request.acceptedDriverAccountId?.toString() === socket.accountId;

  const isAdmin = socket.roles.includes('admin');

  return isCustomer || isAcceptedDriver || isAdmin;
};

const initSocketServer = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    },
  });

  ioInstance.use(authenticateSocket);

  ioInstance.on('connection', async (socket) => {
    console.log(`Socket connected: ${socket.accountId}`);

    socket.join(getAccountRoom(socket.accountId));

    if (socket.roles.includes('admin')) {
      socket.join('admins');
    }

    if (socket.roles.includes('driver')) {
      socket.join('drivers');

      const driverProfile = await DriverProfile.findOne({
        accountId: socket.accountId,
      });

      if (driverProfile?.isOnline) {
        socket.join('online_drivers');
        await joinDriverVehicleRooms(socket);
      }
    }

    socket.emit('socket:connected', {
      success: true,
      message: 'تم الاتصال باللايف بنجاح',
      accountId: socket.accountId,
      roles: socket.roles,
    });

    socket.on('request:join', async (payload = {}, callback) => {
      try {
        const { requestId } = payload;

        if (!requestId) {
          throw new Error('رقم الطلب مطلوب');
        }

        const allowed = await canJoinRequestRoom({
          socket,
          requestId,
        });

        if (!allowed) {
          throw new Error('غير مسموح لك بمتابعة هذا الطلب');
        }

        socket.join(getRequestRoom(requestId));

        if (callback) {
          callback({
            success: true,
            message: 'تم الدخول إلى غرفة الطلب',
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

    socket.on('request:leave', (payload = {}, callback) => {
      const { requestId } = payload;

      if (requestId) {
        socket.leave(getRequestRoom(requestId));
      }

      if (callback) {
        callback({
          success: true,
          message: 'تم الخروج من غرفة الطلب',
        });
      }
    });

    socket.on('driver:go-online', async (payload = {}, callback) => {
      try {
        if (!socket.roles.includes('driver')) {
          throw new Error('هذا الإجراء متاح للسائق فقط');
        }

        const { lat, lng } = payload;

        const driverProfile = await DriverProfile.findOne({
          accountId: socket.accountId,
        });

        if (!driverProfile) {
          throw new Error('ملف السائق غير موجود');
        }

        driverProfile.refreshDebtBlockStatus();

        if (driverProfile.isBlockedForDebt) {
          throw new Error(
            driverProfile.blockedReason ||
              'تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق'
          );
        }

        driverProfile.isOnline = true;
        driverProfile.lastOnlineAt = new Date();

        if (lat !== undefined && lng !== undefined) {
          driverProfile.currentLat = Number(lat);
          driverProfile.currentLng = Number(lng);
          driverProfile.currentLocation = {
            type: 'Point',
            coordinates: [Number(lng), Number(lat)],
          };
        }

        await driverProfile.save();

        socket.join('online_drivers');

        const vehicleCodes = await joinDriverVehicleRooms(socket);

        if (callback) {
          callback({
            success: true,
            message: 'السائق أصبح Online',
            driverProfile,
            vehicleCodes,
          });
        }

        ioInstance.to('admins').emit('driver:online-status-changed', {
          accountId: socket.accountId,
          isOnline: true,
          currentLat: driverProfile.currentLat,
          currentLng: driverProfile.currentLng,
          vehicleCodes,
        });
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

    socket.on('driver:go-offline', async (payload = {}, callback) => {
      try {
        if (!socket.roles.includes('driver')) {
          throw new Error('هذا الإجراء متاح للسائق فقط');
        }

        const driverProfile = await DriverProfile.findOne({
          accountId: socket.accountId,
        });

        if (!driverProfile) {
          throw new Error('ملف السائق غير موجود');
        }

        driverProfile.isOnline = false;
        await driverProfile.save();

        socket.leave('online_drivers');
        clearDriverVehicleRooms(socket);

        if (callback) {
          callback({
            success: true,
            message: 'السائق أصبح Offline',
            driverProfile,
          });
        }

        ioInstance.to('admins').emit('driver:online-status-changed', {
          accountId: socket.accountId,
          isOnline: false,
        });
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            message: error.message,
          });
        }
      }
    });

   socket.on('driver:location', async (payload = {}, callback) => {
  try {
    if (!socket.roles.includes('driver')) {
      throw new Error('هذا الإجراء متاح للسائق فقط');
    }

    const lat = Number(payload.lat ?? payload.latitude);
    const lng = Number(payload.lng ?? payload.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('الموقع مطلوب');
    }

    const requestIdFromPayload = (
      payload.requestId ||
      payload.serviceRequestId ||
      payload.rideId ||
      ''
    )
      .toString()
      .trim();

    const driverProfile = await DriverProfile.findOne({
      accountId: socket.accountId,
    });

    if (!driverProfile) {
      throw new Error('ملف السائق غير موجود');
    }

    driverProfile.currentLat = lat;
    driverProfile.currentLng = lng;
    driverProfile.currentLocation = {
      type: 'Point',
      coordinates: [lng, lat],
    };

    await driverProfile.save();

    const activeRequestId =
      driverProfile.activeServiceRequestId?.toString() || requestIdFromPayload;

    const locationPayload = {
      driverAccountId: socket.accountId,
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      requestId: activeRequestId,
      serviceRequestId: activeRequestId,
      rideId: activeRequestId,
      updatedAt: new Date(),
    };

    if (activeRequestId) {
      emitToRequest(
        activeRequestId,
        'driver:location-updated',
        locationPayload
      );
    }

    ioInstance.to('admins').emit('driver:location-updated', {
      ...locationPayload,
      activeServiceRequestId: activeRequestId,
    });

    if (callback) {
      callback({
        success: true,
        message: 'تم تحديث موقع السائق',
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

    socket.on('disconnect', () => {
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
  emitToAccount,
  emitToRequest,
  emitToVehicle,
};