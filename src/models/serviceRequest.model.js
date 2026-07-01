const mongoose = require("mongoose");

const serviceRequestSchema = new mongoose.Schema(
  {
    requestCode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    serviceType: {
      type: String,
      enum: ["instant_ride", "scheduled_ride", "delivery_order"],
      required: [true, "نوع الخدمة مطلوب"],
    },

    customerAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "رقم حساب العميل مطلوب"],
    },

    acceptedDriverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },

    acceptedDriverVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DriverVehicle",
      default: null,
    },

    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },

    vehicleTypeCode: {
      type: String,
      required: [true, "نوع المركبة مطلوب"],
      trim: true,
      lowercase: true,
    },

    vehicleTypeName: {
      type: String,
      required: [true, "اسم نوع المركبة مطلوب"],
      trim: true,
    },

    pickup: {
      address: {
        type: String,
        required: [true, "عنوان الانطلاق مطلوب"],
        trim: true,
      },
      lat: {
        type: Number,
        required: [true, "خط عرض الانطلاق مطلوب"],
      },
      lng: {
        type: Number,
        required: [true, "خط طول الانطلاق مطلوب"],
      },
      notes: {
        type: String,
        trim: true,
        default: "",
      },
    },
    pickupLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },

    searchRadiusKm: {
      type: Number,
      default: 5,
      min: 1,
      max: 100,
    },

    destination: {
      address: {
        type: String,
        trim: true,
        default: "",
      },
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
      notes: {
        type: String,
        trim: true,
        default: "",
      },
    },

    distanceKm: {
      type: Number,
      default: 0,
      min: 0,
    },

    estimatedPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    customerOfferedPrice: {
      type: Number,
      required: [true, "السعر المعروض من العميل مطلوب"],
      min: 0,
    },

    customerPromoCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromoCode",
      default: null,
    },

    customerPromoCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    customerPromoSnapshot: {
      type: Object,
      default: null,
    },

    customerDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    appCoveredDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    customerPayablePrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    finalPrice: {
      type: Number,
      default: null,
      min: 0,
    },

    finalFareDetails: {
      agreedPrice: {
        type: Number,
        default: 0,
        min: 0,
      },
      originalDistanceKm: {
        type: Number,
        default: 0,
        min: 0,
      },
      actualDistanceKm: {
        type: Number,
        default: 0,
        min: 0,
      },
      extraDistanceKm: {
        type: Number,
        default: 0,
        min: 0,
      },
      pricePerExtraKm: {
        type: Number,
        default: 0,
        min: 0,
      },
      extraDistanceFare: {
        type: Number,
        default: 0,
        min: 0,
      },
      waitingMinutes: {
        type: Number,
        default: 0,
        min: 0,
      },
      waitingPricePerMinute: {
        type: Number,
        default: 0,
        min: 0,
      },
      waitingFare: {
        type: Number,
        default: 0,
        min: 0,
      },
      manualAdjustment: {
        type: Number,
        default: 0,
      },
      totalIncrease: {
        type: Number,
        default: 0,
        min: 0,
      },
      calculatedAt: {
        type: Date,
        default: null,
      },
      note: {
        type: String,
        trim: true,
        default: "",
      },
    },

    commissionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    grossCommissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    driverPromoCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromoCode",
      default: null,
    },

    driverPromoCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    driverPromoSnapshot: {
      type: Object,
      default: null,
    },

    driverPromoDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    driverNetAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    appDriverPayableAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    driverWalletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DriverWallet",
      default: null,
    },

    commissionTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommissionTransaction",
      default: null,
    },

    financeSummary: {
      customerPaidToDriver: {
        type: Number,
        default: 0,
        min: 0,
      },
      appCoveredDiscountAddedToDriverBalance: {
        type: Number,
        default: 0,
        min: 0,
      },
      grossCommissionAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      driverPromoDiscountAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      netCommissionDebtAdded: {
        type: Number,
        default: 0,
        min: 0,
      },
      driverNetAfterCommission: {
        type: Number,
        default: 0,
        min: 0,
      },
      recordedAt: {
        type: Date,
        default: null,
      },
    },

    loyaltySummary: {
      customerPointsEarned: {
        type: Number,
        default: 0,
        min: 0,
      },
      driverPointsEarned: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    paymentMethod: {
      type: String,
      enum: ["cash"],
      default: "cash",
    },

    status: {
      type: String,
      enum: [
        "pending_offers",
        "negotiating",
        "offer_accepted",
        "driver_arriving",
        "arrived_to_pickup",
        "in_progress",
        "completed",
        "cancelled_by_customer",
        "cancelled_by_driver",
        "cancelled_by_admin",
        "expired",
        "driver_no_show",
        "customer_no_show",
      ],
      default: "pending_offers",
    },

    scheduledAt: {
      type: Date,
      default: null,
    },

    dispatchAt: {
      type: Date,
      default: null,
    },

    dispatchedAt: {
      type: Date,
      default: null,
    },

    dispatchStatus: {
      type: String,
      enum: [
        "dispatched",
        "scheduled_waiting",
        "expired",
        "cancelled",
      ],
      default: "dispatched",
    },

    requestExpiresAt: {
      type: Date,
      default: null,
    },

    lastDispatchAttemptAt: {
      type: Date,
      default: null,
    },

    dispatchAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastDispatchedDriversCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    reminderStatus: {
      twoHours: {
        type: Boolean,
        default: false,
      },
      oneHour: {
        type: Boolean,
        default: false,
      },
      thirtyMinutes: {
        type: Boolean,
        default: false,
      },
      tenMinutes: {
        type: Boolean,
        default: false,
      },
    },

    deliveryDetails: {
      itemDescription: {
        type: String,
        trim: true,
        default: "",
      },
      itemCategory: {
        type: String,
        trim: true,
        default: "",
      },
      quantity: {
        type: Number,
        default: 1,
        min: 1,
      },
      itemDeclaredValue: {
        type: Number,
        default: 0,
        min: 0,
      },
      pickupContactName: {
        type: String,
        trim: true,
        default: "",
      },
      pickupContactPhone: {
        type: String,
        trim: true,
        default: "",
      },
      dropoffContactName: {
        type: String,
        trim: true,
        default: "",
      },
      dropoffContactPhone: {
        type: String,
        trim: true,
        default: "",
      },
      itemPaymentResponsibility: {
        type: String,
        enum: [
          "customer_pays_pickup",
          "driver_pays_pickup",
          "prepaid",
        ],
        default: "customer_pays_pickup",
      },
      driverWillPayForItems: {
        type: Boolean,
        default: false,
      },
      expectedItemCost: {
        type: Number,
        default: 0,
        min: 0,
      },
      maxItemCostAllowed: {
        type: Number,
        default: 0,
        min: 0,
      },
      actualItemCost: {
        type: Number,
        default: 0,
        min: 0,
      },
      itemCostPaidByDriver: {
        type: Boolean,
        default: false,
      },
      itemCostConfirmedAt: {
        type: Date,
        default: null,
      },
      itemCostReimbursementAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      customerTotalPayableToDriver: {
        type: Number,
        default: 0,
        min: 0,
      },
      commissionableDeliveryFare: {
        type: Number,
        default: 0,
        min: 0,
      },
      pickupStatus: {
        type: String,
        enum: ["pending", "picked_up"],
        default: "pending",
      },
      pickupConfirmedAt: {
        type: Date,
        default: null,
      },
      pickupProofType: {
        type: String,
        enum: ["none", "note", "photo", "receipt"],
        default: "none",
      },
      pickupProofUrl: {
        type: String,
        trim: true,
        default: "",
      },
      pickupProofNote: {
        type: String,
        trim: true,
        default: "",
      },
      deliveryStatus: {
        type: String,
        enum: ["pending", "delivered"],
        default: "pending",
      },
      deliveredAt: {
        type: Date,
        default: null,
      },
      deliveryProofType: {
        type: String,
        enum: ["none", "note", "photo", "otp", "signature"],
        default: "none",
      },
      deliveryProofUrl: {
        type: String,
        trim: true,
        default: "",
      },
      deliveryProofNote: {
        type: String,
        trim: true,
        default: "",
      },
      recipientName: {
        type: String,
        trim: true,
        default: "",
      },
      recipientPhone: {
        type: String,
        trim: true,
        default: "",
      },
      handoffOtp: {
        type: String,
        trim: true,
        default: "",
      },
      paymentNotes: {
        type: String,
        trim: true,
        default: "",
      },
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: "",
    },

    acceptedOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceOffer",
      default: null,
    },

    confirmedAt: {
      type: Date,
      default: null,
    },

    driverArrivingAt: {
      type: Date,
      default: null,
    },

    arrivedAt: {
      type: Date,
      default: null,
    },

    lifecycleLockToken: {
      type: String,
      trim: true,
      default: null,
    },

    lifecycleLockReason: {
      type: String,
      trim: true,
      default: "",
    },

    lifecycleLockedAt: {
      type: Date,
      default: null,
    },

    lastStatusChangedAt: {
      type: Date,
      default: null,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

serviceRequestSchema.index({ customerAccountId: 1, createdAt: -1 });
serviceRequestSchema.index({ acceptedDriverAccountId: 1, status: 1 });
serviceRequestSchema.index({ serviceType: 1, status: 1, vehicleTypeCode: 1 });
serviceRequestSchema.index({ scheduledAt: 1, status: 1 });
serviceRequestSchema.index({ dispatchAt: 1, dispatchStatus: 1, status: 1 });
serviceRequestSchema.index({ requestExpiresAt: 1, status: 1 });
serviceRequestSchema.index({ pickupLocation: "2dsphere" });
serviceRequestSchema.index({ customerPromoCodeId: 1 });
serviceRequestSchema.index({ driverPromoCodeId: 1 });
serviceRequestSchema.index({ driverWalletId: 1 });
serviceRequestSchema.index({ commissionTransactionId: 1 });
serviceRequestSchema.index({ "deliveryDetails.pickupStatus": 1, serviceType: 1 });
serviceRequestSchema.index({ "deliveryDetails.deliveryStatus": 1, serviceType: 1 });
serviceRequestSchema.index({ acceptedDriverAccountId: 1, completedAt: -1 });
serviceRequestSchema.index({ lifecycleLockToken: 1 });
serviceRequestSchema.index(
  { _id: 1, status: 1, acceptedOfferId: 1, lifecycleLockToken: 1 },
);

serviceRequestSchema.methods.toSafeObject = function () {
  const request = this.toObject();

  delete request.__v;

  return request;
};

const ServiceRequest = mongoose.model("ServiceRequest", serviceRequestSchema);

module.exports = ServiceRequest;
