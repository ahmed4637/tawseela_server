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

    commissionAmount: {
      type: Number,
      default: 0,
      min: 0,
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
      driverWillPayForItems: {
        type: Boolean,
        default: false,
      },
      expectedItemCost: {
        type: Number,
        default: 0,
        min: 0,
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
serviceRequestSchema.index({ pickupLocation: "2dsphere" });

serviceRequestSchema.methods.toSafeObject = function () {
  const request = this.toObject();

  delete request.__v;

  return request;
};

const ServiceRequest = mongoose.model("ServiceRequest", serviceRequestSchema);

module.exports = ServiceRequest;
