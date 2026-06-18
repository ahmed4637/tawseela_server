const mongoose = require('mongoose');

const commissionTransactionSchema = new mongoose.Schema(
  {
    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
    },

    type: {
      type: String,
      enum: ['commission'],
      default: 'commission',
    },

    serviceType: {
      type: String,
      enum: ['instant_ride', 'scheduled_ride', 'delivery_order'],
      required: true,
    },

    vehicleTypeCode: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },

    finalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    commissionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ['unpaid', 'paid', 'cancelled'],
      default: 'unpaid',
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

commissionTransactionSchema.index(
  { serviceRequestId: 1, type: 1 },
  { unique: true }
);

commissionTransactionSchema.index({
  driverAccountId: 1,
  status: 1,
  createdAt: -1,
});

const CommissionTransaction = mongoose.model(
  'CommissionTransaction',
  commissionTransactionSchema
);

module.exports = CommissionTransaction;