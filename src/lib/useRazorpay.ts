'use client';

import { useState, useEffect, useCallback } from 'react';

interface PaymentConfig {
  paymentEnabled: boolean;
  slotPaymentRequired: boolean;
  packagePaymentRequired: boolean;
  razorpayKeyId: string;
  cashPaymentEnabled: boolean;
}

interface RazorpayOrderResponse {
  orderId: string;
  paymentId: string; // Our internal payment ID
  amount: number; // in paise
  currency: string;
  keyId: string;
}

interface UseRazorpayOptions {
  onSuccess?: (data: { paymentId: string; razorpayPaymentId: string; type: string }) => void;
  onFailure?: (error: string) => void;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: () => void) => void;
    };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function usePaymentConfig() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/payments/config')
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading };
}

export function useRazorpay(options: UseRazorpayOptions = {}, paymentEnabled = true) {
  const [processing, setProcessing] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    // Only load Razorpay script when payment is actually enabled
    if (paymentEnabled) {
      loadRazorpayScript().then(setScriptLoaded);
    }
  }, [paymentEnabled]);

  const initiatePayment = useCallback(
    async (params: {
      type: 'SLOT_BOOKING' | 'PACKAGE_PURCHASE';
      amount: number;
      packageId?: string;
      slots?: Array<{ date: string; startTime: string; endTime: string }>;
      metadata?: Record<string, string>;
      prefill?: { name?: string; email?: string; contact?: string };
      description?: string;
    }) => {
      if (!scriptLoaded) {
        options.onFailure?.('Razorpay SDK not loaded. Please refresh and try again.');
        return null;
      }

      setProcessing(true);

      try {
        // Step 1: Create order on our backend
        const orderRes = await fetch('/api/payments/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: params.type,
            amount: params.amount,
            packageId: params.packageId,
            slots: params.slots,
            metadata: params.metadata,
          }),
        });

        if (!orderRes.ok) {
          const err = await orderRes.json();
          throw new Error(err.error || 'Failed to create payment order');
        }

        const order: RazorpayOrderResponse = await orderRes.json();

        // Step 2: Open Razorpay checkout
        return new Promise<{ paymentId: string; razorpayPaymentId: string; type: string } | null>(
          (resolve) => {
            const rzpOptions: Record<string, unknown> = {
              key: order.keyId,
              amount: order.amount,
              currency: order.currency,
              name: 'ABCA Cricket Academy',
              description: params.description || (params.type === 'PACKAGE_PURCHASE' ? 'Package Purchase' : 'Slot Booking'),
              order_id: order.orderId,
              prefill: params.prefill || {},
              theme: {
                color: '#d4a843',
              },
              handler: async (response: {
                razorpay_order_id: string;
                razorpay_payment_id: string;
                razorpay_signature: string;
              }) => {
                try {
                  // Step 3: Verify payment on our backend
                  const verifyRes = await fetch('/api/payments/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      razorpay_order_id: response.razorpay_order_id,
                      razorpay_payment_id: response.razorpay_payment_id,
                      razorpay_signature: response.razorpay_signature,
                      paymentId: order.paymentId,
                    }),
                  });

                  if (!verifyRes.ok) {
                    const err = await verifyRes.json();
                    throw new Error(err.error || 'Payment verification failed');
                  }

                  const result = await verifyRes.json();
                  const successData = {
                    paymentId: order.paymentId,
                    razorpayPaymentId: response.razorpay_payment_id,
                    type: params.type,
                  };

                  options.onSuccess?.(successData);
                  resolve(successData);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'Verification failed';
                  options.onFailure?.(msg);
                  resolve(null);
                } finally {
                  setProcessing(false);
                }
              },
              modal: {
                ondismiss: () => {
                  setProcessing(false);
                  resolve(null);
                },
              },
            };

            const rzp = new window.Razorpay(rzpOptions);
            rzp.on('payment.failed', () => {
              options.onFailure?.('Payment failed. Please try again.');
              setProcessing(false);
              resolve(null);
            });
            rzp.open();
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Payment initiation failed';
        options.onFailure?.(msg);
        setProcessing(false);
        return null;
      }
    },
    [scriptLoaded, options],
  );

  return { initiatePayment, processing, scriptLoaded };
}
