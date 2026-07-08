const path = require('path');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { sendSuccess, sendError } = require('./utils/apiResponse');

const authRoutes = require('./routes/auth.routes');
const addressRoutes = require('./routes/address.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const serviceRequestRoutes = require('./routes/serviceRequest.routes');
const offerRoutes = require('./routes/offer.routes');
const driverFinanceRoutes = require('./routes/driverFinance.routes');
const adminRoutes = require('./routes/admin.routes');
const uploadRoutes = require('./routes/upload.routes');
const notificationRoutes = require('./routes/notification.routes');
const adminNotificationRoutes = require('./routes/adminNotification.routes');
const trackingRoutes = require('./routes/tracking.routes');
const adminTrackingRoutes = require('./routes/adminTracking.routes');
const ratingRoutes = require('./routes/rating.routes');
const complaintRoutes = require('./routes/complaint.routes');
const adminComplaintRoutes = require('./routes/adminComplaint.routes');
const supportRoutes = require('./routes/support.routes');
const safetyRoutes = require('./routes/safety.routes');
const adminSupportRoutes = require('./routes/adminSupport.routes');
const adminSafetyRoutes = require('./routes/adminSafety.routes');
const adminReportRoutes = require('./routes/adminReport.routes');
const adminLiveRoutes = require('./routes/adminLive.routes');
const adminDriverReviewRoutes = require('./routes/adminDriverReview.routes');
const adminRoleRoutes = require('./routes/adminRole.routes');
const chatRoutes = require('./routes/chat.routes');
const promoRoutes = require('./routes/promo.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const adminPromoRoutes = require('./routes/adminPromo.routes');
const adminLoyaltyRoutes = require('./routes/adminLoyalty.routes');
const accountRestrictionRoutes = require('./routes/accountRestriction.routes');
const adminPenaltyRoutes = require('./routes/adminPenalty.routes');
const settingsRoutes = require('./routes/settings.routes');
const serviceTypeRoutes = require('./routes/serviceType.routes');
const serviceVehicleConfigRoutes = require('./routes/serviceVehicleConfig.routes');
const adminAuditLogRoutes = require('./routes/adminAuditLog.routes');
const adminServiceTypeRoutes = require('./routes/adminServiceType.routes');
const adminServiceVehicleConfigRoutes = require('./routes/adminServiceVehicleConfig.routes');
const adminDispatchSettingRoutes = require('./routes/adminDispatchSetting.routes');
const mapRoutes = require('./routes/map.routes');
const systemRoutes = require('./routes/system.routes');

const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.get('/', (req, res) => {
  return sendSuccess({
    res,
    message: 'Tawseela API is running',
  });
});

app.get('/health', (req, res) => {
  return sendSuccess({
    res,
    message: 'Server is healthy',
    extra: {
      timestamp: new Date().toISOString(),
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/address', addressRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/dashboard/vehicles', vehicleRoutes);
app.use('/api/requests', serviceRequestRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/driver-finance', driverFinanceRoutes);
app.use('/api/services', serviceTypeRoutes);
app.use('/api/service-vehicle-configs', serviceVehicleConfigRoutes);
app.use('/api/admin/audit-logs', adminAuditLogRoutes);
app.use('/api/admin/service-types', adminServiceTypeRoutes);
app.use('/api/admin/service-vehicle-configs', adminServiceVehicleConfigRoutes);
app.use('/api/admin/dispatch-settings', adminDispatchSettingRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/admin/tracking', adminTrackingRoutes);
app.use('/api/admin/promos', adminPromoRoutes);
app.use('/api/admin/loyalty', adminLoyaltyRoutes);
app.use('/api/admin/complaints', adminComplaintRoutes);
app.use('/api/admin/support', adminSupportRoutes);
app.use('/api/admin/safety', adminSafetyRoutes);
app.use('/api/admin/reports', adminReportRoutes);
app.use('/api/admin/live', adminLiveRoutes);
app.use('/api/admin/driver-reviews', adminDriverReviewRoutes);
app.use('/api/admin/roles', adminRoleRoutes);
app.use('/api/admin', adminPenaltyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/account/restrictions', accountRestrictionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api/system', systemRoutes);

app.use((req, res) => {
  return sendError({
    res,
    statusCode: 404,
    message: 'المسار غير موجود',
  });
});

app.use(errorHandler);

module.exports = app;