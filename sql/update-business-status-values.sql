alter table public.businesses
    drop constraint if exists businesses_subscription_status_check,
    add constraint businesses_subscription_status_check
        check (subscription_status in ('trial', 'active', 'past_due', 'deactivated', 'expired', 'demo'));

alter table public.subscriptions
    drop constraint if exists subscriptions_status_check,
    add constraint subscriptions_status_check
        check (status in ('trial', 'active', 'past_due', 'deactivated', 'expired', 'demo'));
