const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    token: {
      type: String,
      required: true,
      trim: true,
    },

    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      required: true,
    },

    deviceId: {
      type: String,
      trim: true,
      default: '',
    },

    appVersion: {
      type: String,
      trim: true,
      default: '',
    },

    locale: {
      type: String,
      trim: true,
      default: 'ar',
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    disabledReason: {
      type: String,
      trim: true,
      default: '',
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

deviceTokenSchema.index({ token: 1 }, { unique: true });
deviceTokenSchema.index({ accountId: 1, platform: 1, isActive: 1 });
deviceTokenSchema.index(
  { accountId: 1, deviceId: 1 },
  {
    partialFilterExpression: {
      deviceId: { $type: 'string', $ne: '' },
    },
  }
);

const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

module.exports = DeviceToken;
