export type CadenceType =
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "yearly"
  | "custom";

export type Subscription = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cadenceType: CadenceType;
  cadenceMonths: number;
  nextChargeDate: string;
  remindCancel: boolean;
  remindLeadDays: number | null;
  archived: boolean;
  notes: string | null;
  cancelUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionWritePayload = {
  name: string;
  amount: number;
  currency: string;
  cadenceType: CadenceType;
  cadenceMonths: number;
  nextChargeDate: string;
  remindCancel: boolean;
  remindLeadDays: number | null;
  archived: boolean;
  notes: string | null;
  cancelUrl: string | null;
};

export type FxRate = {
  currency: string;
  rateToEur: number;
  createdAt: string;
  updatedAt: string;
};

export type SettingsMap = Record<string, string>;
