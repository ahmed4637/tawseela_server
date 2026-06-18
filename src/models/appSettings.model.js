const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'main',
      unique: true,
    },

    driverCommissionDebtLimit: {
      type: Number,
      default: 200,
      min: 0,
    },

    searchRadiusKm: {
      instantRide: {
        type: Number,
        default: 5,
        min: 1,
        max: 100,
      },

      deliveryOrder: {
        type: Number,
        default: 8,
        min: 1,
        max: 100,
      },

      scheduledRide: {
        type: Number,
        default: 25,
        min: 1,
        max: 100,
      },
    },

    scheduledRemindersMinutes: {
      twoHours: {
        type: Number,
        default: 120,
        min: 1,
      },

      oneHour: {
        type: Number,
        default: 60,
        min: 1,
      },

      thirtyMinutes: {
        type: Number,
        default: 30,
        min: 1,
      },

      tenMinutes: {
        type: Number,
        default: 10,
        min: 1,
      },
    },

    support: {
      phone: {
        type: String,
        trim: true,
        default: '',
      },

      whatsapp: {
        type: String,
        trim: true,
        default: '',
      },

      email: {
        type: String,
        trim: true,
        lowercase: true,
        default: '',
      },
    },

    appStatus: {
      isMaintenanceMode: {
        type: Boolean,
        default: false,
      },

      maintenanceMessage: {
        type: String,
        trim: true,
        default: 'التطبيق تحت الصيانة حاليًا',
      },
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

const AppSettings = mongoose.model('AppSettings', appSettingsSchema);

module.exports = AppSettings;