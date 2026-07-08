const mongoose = require('mongoose');

const safetyIncidentSchema = new mongoose.Schema(
  {
    incidentCode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: [true, 'رقم الطلب مطلوب'],
    },

    reporterAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب المبلغ مطلوب'],
    },

    reporterRole: {
      type: String,
      enum: ['customer', 'driver', 'admin', 'unknown'],
      default: 'unknown',
    },

    customerAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    type: {
      type: String,
      enum: [
        'emergency',
        'unsafe_behavior',
        'accident',
        'route_issue',
        'vehicle_issue',
        'payment_conflict',
        'other',
      ],
      default: 'emergency',
    },

    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'critical',
    },

    status: {
      type: String,
      enum: ['open', 'acknowledged', 'in_progress', 'resolved', 'closed'],
      default: 'open',
    },

    title: {
      type: String,
      trim: true,
      default: 'بلاغ أمان عاجل',
      maxlength: [160, 'عنوان البلاغ طويل جدًا'],
    },

    message: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'تفاصيل البلاغ طويلة جدًا'],
    },

    location: {
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
      address: {
        type: String,
        trim: true,
        default: '',
      },
      capturedAt: {
        type: Date,
        default: null,
      },
    },

    metadata: {
      type: Object,
      default: {},
    },

    acknowledgedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    acknowledgedAt: {
      type: Date,
      default: null,
    },

    resolvedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    lastAdminNote: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'ملاحظة الأدمن طويلة جدًا'],
    },
  },
  {
    timestamps: true,
  },
);

safetyIncidentSchema.index({ status: 1, severity: 1, createdAt: -1 });
safetyIncidentSchema.index({ serviceRequestId: 1, createdAt: -1 });
safetyIncidentSchema.index({ reporterAccountId: 1, createdAt: -1 });
safetyIncidentSchema.index({ customerAccountId: 1, createdAt: -1 });
safetyIncidentSchema.index({ driverAccountId: 1, createdAt: -1 });

safetyIncidentSchema.pre('save', function () {
  if (this.incidentCode) {
    return;
  }

  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  const timePart = Date.now().toString().slice(-6);
  this.incidentCode = `SAFE-${timePart}-${random}`;
});

module.exports = mongoose.model('SafetyIncident', safetyIncidentSchema);
