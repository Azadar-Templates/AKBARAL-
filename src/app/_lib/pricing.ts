export type AkbaralPlan = {
  key: string;
  name: string;
  price: string;
  tasks: string;
  note: string;
};

export const AKBARAL_PLANS: AkbaralPlan[] = [
  { key: 'free', name: 'Free', price: '$0', tasks: '5 tasks', note: '30-day trial' },
  { key: 'starter', name: 'Starter', price: '$10', tasks: '25 tasks', note: 'Monthly capacity' },
  { key: 'pro', name: 'Pro', price: '$50', tasks: '100 tasks', note: 'Monthly capacity' },
  { key: 'business', name: 'Business', price: '$90', tasks: '250 tasks', note: 'Monthly capacity' },
  { key: 'scale', name: 'Scale', price: '$200', tasks: '750 tasks', note: 'Monthly capacity' },
  { key: 'enterprise', name: 'Enterprise', price: '$400', tasks: '2,000 tasks', note: 'Monthly capacity' },
];

export const PRICING_NOTE = 'All prices are USD. Work task credits are consumed only when a task completes successfully.';
