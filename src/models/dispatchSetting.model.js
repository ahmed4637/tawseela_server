const mongoose = require('mongoose');

const { SERVICE_TYPE_KEYS } = require('./serviceType.model');

const dispatchSettingSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      required: [true, 'نوع الخدمة مطلوب'],
      enum: SERVICE_TYPE_KEYS,
      trim: true,
      lowercase: true,
    },

    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: [true, 'نوع المركبة مطلوب'],
    },

    vehicleTypeCode: {
      type: String,
      required: [true, 'كود نوع المركبة مطلوب'],
      trim: true,
      lowercase: true,
    },

    vehicleTypeName: {
      type: String,
      required: [true, 'اسم نوع المركبة مطلوب'],
      trim: true,
    },

    radiusKm: {
      type: Number,
      default: 5,
      min: 1,
      max: 100,
    },

    maxDriversToNotify: {
      type: Number,
      default: 20,
      min: 1,
      max: 500,
    },

    requestExpirySeconds: {
      type: Number,
      default: 120,
      min: 10,
    },

    offerExpirySeconds: {
      type: Number,
      default: 60,
      min: 10,
    },

    locationFreshnessSeconds: {
      type: Number,
      default: 30,
      min: 5,
    },

    useDriverScore: {
      type: Boolean,
      default: false,
    },

    useDistancePriority: {
      type: Boolean,
      default: true,
    },

    useAcceptanceRate: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    updatedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

dispatchSettingSchema.index(
  { serviceType: 1, vehicleTypeCode: 1 },
  { unique: true }
);
dispatchSettingSchema.index({ serviceType: 1, isActive: 1 });
dispatchSettingSchema.index({ vehicleTypeId: 1, isActive: 1 });

const DispatchSetting = mongoose.model('DispatchSetting', dispatchSettingSchema);

module.exports = DispatchSetting;
