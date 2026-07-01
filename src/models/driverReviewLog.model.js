const mongoose = require('mongoose');

const driverReviewLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ['driver_profile', 'driver_vehicle'],
      required: true,
      index: true,
    },

    driverProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverProfile',
      default: null,
      index: true,
    },

    driverVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverVehicle',
      default: null,
      index: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    action: {
      type: String,
      enum: [
        'submitted',
        'resubmitted',
        'approved',
        'rejected',
        'needs_update',
        'auto_offline',
      ],
      required: true,
      index: true,
    },

    oldReviewStatus: {
      type: String,
      default: '',
      trim: true,
    },

    newReviewStatus: {
      type: String,
      default: '',
      trim: true,
    },

    reason: {
      type: String,
      trim: true,
      default: '',
    },

    adminAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
      index: true,
    },

    source: {
      type: String,
      enum: ['driver_app', 'admin_dashboard', 'system'],
      default: 'system',
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

driverReviewLogSchema.index({ createdAt: -1 });
driverReviewLogSchema.index({ accountId: 1, entityType: 1, createdAt: -1 });

const DriverReviewLog = mongoose.model('DriverReviewLog', driverReviewLogSchema);

module.exports = DriverReviewLog;
