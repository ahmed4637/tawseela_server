const mongoose = require('mongoose');

const driverProfileSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      unique: true,
    },

    nationalIdImage: {
      type: String,
      required: [true, 'صورة البطاقة مطلوبة'],
      trim: true,
    },

    profileImage: {
      type: String,
      trim: true,
      default: '',
    },

    isApproved: {
      type: Boolean,
      default: false,
    },

    isOnline: {
      type: Boolean,
      default: false,
    },

    isAvailable: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    activeServiceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
    },

    currentVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverVehicle',
      default: null,
    },

    currentLat: {
      type: Number,
      default: null,
    },

    currentLng: {
      type: Number,
      default: null,
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
    },


    currentLocationUpdatedAt: {
      type: Date,
      default: null,
    },

    currentLocationAccuracy: {
      type: Number,
      default: null,
      min: 0,
    },

    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalCompletedTrips: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionDebt: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionDebtLimit: {
      type: Number,
      default: 200,
      min: 0,
    },

    isBlockedForDebt: {
      type: Boolean,
      default: false,
    },

    blockedReason: {
      type: String,
      trim: true,
      default: '',
    },

    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_update'],
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

    reviewedAt: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    lastOnlineAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverProfileSchema.index({ reviewStatus: 1, createdAt: -1 });

driverProfileSchema.index({
  isApproved: 1,
  isOnline: 1,
  isAvailable: 1,
  isBlockedForDebt: 1,
  activeServiceRequestId: 1,
});

driverProfileSchema.index({ currentLocation: '2dsphere' });

driverProfileSchema.methods.canReceiveRequests = function () {
  return (
    this.isActive &&
    this.isApproved &&
    this.isOnline &&
    this.isAvailable &&
    !this.isBlockedForDebt &&
    !this.activeServiceRequestId &&
    this.commissionDebt < this.commissionDebtLimit
  );
};

driverProfileSchema.methods.refreshDebtBlockStatus = function () {
  if (this.commissionDebt >= this.commissionDebtLimit) {
    this.isBlockedForDebt = true;
    this.blockedReason = 'تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق';
  } else {
    this.isBlockedForDebt = false;
    this.blockedReason = '';
  }
};

driverProfileSchema.methods.toSafeObject = function () {
  const profile = this.toObject();

  delete profile.__v;

  return profile;
};

const DriverProfile = mongoose.model('DriverProfile', driverProfileSchema);

module.exports = DriverProfile;