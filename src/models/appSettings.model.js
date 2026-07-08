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

    scheduledRide: {
      dispatchBeforeMinutes: {
        // متروك للتوافق مع أي بيانات قديمة فقط.
        // الحجز بموعد يرسل للسائقين فورًا، لذلك القيمة الافتراضية 0.
        type: Number,
        default: 0,
        min: 0,
      },

      minLeadMinutes: {
        type: Number,
        default: 15,
        min: 0,
      },

      expireAfterScheduledMinutes: {
        type: Number,
        default: 30,
        min: 1,
      },

      reminderToleranceMinutes: {
        type: Number,
        default: 5,
        min: 1,
      },
    },

    requestLifecycle: {
      instantRequestExpiryMinutes: {
        type: Number,
        default: 15,
        min: 1,
      },

      deliveryRequestExpiryMinutes: {
        type: Number,
        default: 20,
        min: 1,
      },

      scheduledRequestExpiryAfterMinutes: {
        type: Number,
        default: 30,
        min: 1,
      },

      offerExpiryMinutes: {
        type: Number,
        default: 5,
        min: 1,
      },

      workerIntervalSeconds: {
        type: Number,
        default: 60,
        min: 15,
      },

      cleanupBatchLimit: {
        type: Number,
        default: 200,
        min: 10,
        max: 1000,
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

      isUpdateCheckEnabled: {
        type: Boolean,
        default: true,
      },

      androidMinimumVersion: {
        type: String,
        trim: true,
        default: '1.0.0',
      },

      androidLatestVersion: {
        type: String,
        trim: true,
        default: '1.0.0',
      },

      androidUpdateUrl: {
        type: String,
        trim: true,
        default: '',
      },

      forceUpdateMessage: {
        type: String,
        trim: true,
        default: 'يوجد تحديث جديد مطلوب لتشغيل تطبيق توصيلة بأمان',
      },

      softUpdateMessage: {
        type: String,
        trim: true,
        default: 'يوجد إصدار أحدث من تطبيق توصيلة',
      },
    },

    loyalty: {
      isEnabled: {
        type: Boolean,
        default: true,
      },

      customerEarnPointsPerFarePound: {
        type: Number,
        default: 1,
        min: 0,
      },

      driverEarnPointsPerCompletedRequest: {
        type: Number,
        default: 10,
        min: 0,
      },

      customerAfterAcceptanceCancelDeductionPoints: {
        type: Number,
        default: 100,
        min: 0,
      },

      driverAfterAcceptanceCancelDeductionPoints: {
        type: Number,
        default: 0,
        min: 0,
      },

      allowNegativeBalance: {
        type: Boolean,
        default: false,
      },

      tierRules: {
        silver: {
          type: Number,
          default: 500,
          min: 0,
        },

        gold: {
          type: Number,
          default: 1500,
          min: 0,
        },

        platinum: {
          type: Number,
          default: 5000,
          min: 0,
        },
      },
    },


    tracking: {
      liveUpdateSeconds: {
        type: Number,
        default: 1,
        min: 1,
      },

      driverProfileSaveSeconds: {
        type: Number,
        default: 3,
        min: 1,
      },

      dbSaveSeconds: {
        type: Number,
        default: 5,
        min: 1,
      },

      minDistanceMetersToSave: {
        type: Number,
        default: 10,
        min: 0,
      },

      staleLocationWarningSeconds: {
        type: Number,
        default: 30,
        min: 5,
      },

      saveOnlyDuringActiveRequest: {
        type: Boolean,
        default: true,
      },

      adminLiveTrackingEnabled: {
        type: Boolean,
        default: true,
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