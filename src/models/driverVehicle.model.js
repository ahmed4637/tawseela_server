const mongoose = require('mongoose');

const VEHICLE_CODES_WITHOUT_LICENSE = [
  'tuktuk',
  'tricycle',
  'motorcycle',
];

const driverVehicleSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
    },

    vehicleTypeCode: {
      type: String,
      required: [true, 'نوع المركبة مطلوب'],
      trim: true,
      lowercase: true,
    },

    vehicleTypeName: {
      type: String,
      required: [true, 'اسم نوع المركبة مطلوب'],
      trim: true,
    },

    model: {
      type: String,
      trim: true,
      default: '',
    },

    plateNumber: {
      type: String,
      trim: true,
      default: '',
    },

    color: {
      type: String,
      trim: true,
      default: '',
    },

    vehicleImage: {
      type: String,
      required: [true, 'صورة المركبة مطلوبة'],
      trim: true,
    },

    licenseImage: {
      type: String,
      trim: true,
      default: '',
    },

    licenseRequired: {
      type: Boolean,
      default: true,
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },

    isApproved: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },

    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },

    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverVehicleSchema.pre('validate', function () {
  const code = this.vehicleTypeCode?.toString().trim().toLowerCase();

  this.licenseRequired = !VEHICLE_CODES_WITHOUT_LICENSE.includes(code);

  if (this.licenseRequired && !this.licenseImage) {
    this.invalidate(
      'licenseImage',
      'صورة الرخصة مطلوبة لهذا النوع من المركبات'
    );
  }
});

driverVehicleSchema.index({ accountId: 1, isActive: 1 });
driverVehicleSchema.index({ accountId: 1, vehicleTypeCode: 1, plateNumber: 1 });

driverVehicleSchema.methods.toSafeObject = function () {
  const vehicle = this.toObject();

  delete vehicle.__v;

  return vehicle;
};

const DriverVehicle = mongoose.model('DriverVehicle', driverVehicleSchema);

module.exports = DriverVehicle;