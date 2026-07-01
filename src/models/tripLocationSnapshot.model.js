const mongoose = require('mongoose');

const tripLocationSnapshotSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: [true, 'رقم الطلب مطلوب'],
      index: true,
    },

    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'حساب السائق مطلوب'],
      index: true,
    },

    customerAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
      index: true,
    },

    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },

    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },

    lng: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },

    speed: {
      type: Number,
      default: null,
      min: 0,
    },

    heading: {
      type: Number,
      default: null,
      min: 0,
      max: 360,
    },

    accuracy: {
      type: Number,
      default: null,
      min: 0,
    },

    phase: {
      type: String,
      enum: ['driver_arriving', 'in_trip'],
      required: true,
    },

    source: {
      type: String,
      enum: ['driver_app', 'admin', 'system'],
      default: 'driver_app',
    },

    requestStatus: {
      type: String,
      trim: true,
      default: '',
    },

    metadata: {
      type: Object,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

tripLocationSnapshotSchema.index({ location: '2dsphere' });
tripLocationSnapshotSchema.index({ serviceRequestId: 1, createdAt: -1 });
tripLocationSnapshotSchema.index({ driverAccountId: 1, createdAt: -1 });
tripLocationSnapshotSchema.index({ phase: 1, createdAt: -1 });

const TripLocationSnapshot = mongoose.model(
  'TripLocationSnapshot',
  tripLocationSnapshotSchema
);

module.exports = TripLocationSnapshot;
