const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم المركبة مطلوب'],
      trim: true,
      unique: true,
    },

    code: {
      type: String,
      required: [true, 'كود المركبة مطلوب'],
      trim: true,
      lowercase: true,
      unique: true,
    },

    category: {
      type: String,
      enum: ['passenger', 'goods', 'mixed'],
      default: 'passenger',
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    seatsCount: {
      type: Number,
      default: 1,
      min: 0,
    },

    maxLoadKg: {
      type: Number,
      default: 0,
      min: 0,
    },

    canCarryPassengers: {
      type: Boolean,
      default: true,
    },

    canCarryGoods: {
      type: Boolean,
      default: false,
    },

    allowedServices: {
      type: [String],
      enum: ['instant_ride', 'scheduled_ride', 'delivery_order'],
      default: ['instant_ride'],
    },

    startPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    pricePerKm: {
      type: Number,
      default: 0,
      min: 0,
    },

    minPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    commission: {
      instantRidePercent: {
        type: Number,
        default: 15,
        min: 0,
        max: 100,
      },

      scheduledRidePercent: {
        type: Number,
        default: 10,
        min: 0,
        max: 100,
      },

      deliveryOrderPercent: {
        type: Number,
        default: 12,
        min: 0,
        max: 100,
      },
    },

    requiresLicense: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

vehicleSchema.index({ isActive: 1, order: 1 });

vehicleSchema.methods.toSafeObject = function () {
  const vehicle = this.toObject();

  delete vehicle.__v;

  return vehicle;
};

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

module.exports = Vehicle;