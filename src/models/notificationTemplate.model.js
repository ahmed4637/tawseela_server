const mongoose = require('mongoose');

const notificationTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    titleAr: {
      type: String,
      required: true,
      trim: true,
    },

    bodyAr: {
      type: String,
      required: true,
      trim: true,
    },

    titleEn: {
      type: String,
      trim: true,
      default: '',
    },

    bodyEn: {
      type: String,
      trim: true,
      default: '',
    },

    targetType: {
      type: String,
      enum: ['customer', 'driver', 'admin', 'all'],
      default: 'all',
    },

    type: {
      type: String,
      enum: [
        'general',
        'request',
        'offer',
        'negotiation',
        'trip',
        'chat',
        'payment',
        'promo',
        'loyalty',
        'penalty',
        'complaint',
        'review',
        'scheduled_reminder',
        'admin',
      ],
      default: 'general',
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationTemplateSchema.index({ isActive: 1, targetType: 1 });

const NotificationTemplate = mongoose.model(
  'NotificationTemplate',
  notificationTemplateSchema
);

module.exports = NotificationTemplate;
