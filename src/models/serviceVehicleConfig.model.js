const mongoose = require('mongoose');

const { SERVICE_TYPE_KEYS } = require('./serviceType.model');

const serviceVehicleConfigSchema = new mongoose.Schema(
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

    isActive: {
      type: Boolean,
      default: true,
    },

    minFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    baseFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    pricePerKm: {
      type: Number,
      default: 0,
      min: 0,
    },

    pricePerMinute: {
      type: Number,
      default: 0,
      min: 0,
    },

    waitingPricePerMinute: {
      type: Number,
      default: 0,
      min: 0,
    },

    extraPricePerKm: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage',
    },

    commissionValue: {
      type: Number,
      default: 0,
      min: 0,
    },

    defaultRadiusKm: {
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

    allowNegotiation: {
      type: Boolean,
      default: true,
    },

    allowCoupon: {
      type: Boolean,
      default: true,
    },

    notes: {
      type: String,
      trim: true,
      default: '',
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

serviceVehicleConfigSchema.index(
  { serviceType: 1, vehicleTypeCode: 1 },
  { unique: true }
);
serviceVehicleConfigSchema.index({ serviceType: 1, isActive: 1 });
serviceVehicleConfigSchema.index({ vehicleTypeId: 1, isActive: 1 });

serviceVehicleConfigSchema.methods.toSafeObject = function () {
  const config = this.toObject();
  delete config.__v;
  return config;
};

const ServiceVehicleConfig = mongoose.model(
  'ServiceVehicleConfig',
  serviceVehicleConfigSchema
);

module.exports = ServiceVehicleConfig;
