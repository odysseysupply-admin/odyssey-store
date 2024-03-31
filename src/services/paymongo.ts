import {
  AbstractPaymentProcessor,
  CartService,
  MedusaContainer,
  PaymentProcessorContext,
  PaymentProcessorError,
  PaymentProcessorSessionResponse,
  PaymentSessionStatus,
} from '@medusajs/medusa';

class PaymongoPaymentService extends AbstractPaymentProcessor {
  static identifier = 'paymongo';

  protected readonly cartService: CartService;
  protected readonly paymongoAPIKey: string;
  protected readonly baseURL: string;

  constructor(
    container: MedusaContainer,
    config: Record<string, unknown> | undefined
  ) {
    super(container as any);
    const paymongoApiKey =
      (config?.apiKey as string) || process.env.PAYMONGO_API_KEY || '';

    this.paymongoAPIKey = Buffer.from(paymongoApiKey).toString('base64');
    this.baseURL = process.env.STORE_CORS || 'http://localhost:3000';
    // @ts-expect-error - Container is just an object - https://docs.medusajs.com/development/fundamentals/dependency-injection#in-classes
    this.cartService = container.cartService;
  }

  protected async fetchPaymongo({
    method = 'POST',
    path,
    body,
  }: {
    path: string;
    method?: string;
    body?: any;
  }) {
    const options = {
      method: method,
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: `Basic ${this.paymongoAPIKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(`https://api.paymongo.com/v1/${path}`, options);

    if (!res.ok) {
      this.buildError('Unable to fetch from paymongo', {
        code: String(res.status),
        detail: res.statusText,
      });
    }
    return await res.json();
  }

  async initiatePayment(context: PaymentProcessorContext): Promise<
    | PaymentProcessorError
    | (PaymentProcessorSessionResponse & {
        session_data: {
          checkout_url: string;
          paymentIntentId: string;
          paymentStatus: string;
        };
      })
  > {
    const cart = await this.cartService.retrieveWithTotals(context.resource_id);
    const { shipping_address: shippingAddress, email, total } = cart;

    const body = {
      data: {
        attributes: {
          billing: {
            address: {
              line1: shippingAddress.address_1,
              city: shippingAddress.city,
              state: shippingAddress.province,
              postal_code: shippingAddress.province,
              country: shippingAddress.country_code.toUpperCase(),
            },
            name: `${shippingAddress.first_name} ${shippingAddress.last_name}`,
            email: email,
            phone: shippingAddress.phone,
          },
          send_email_receipt: false,
          show_description: false,
          show_line_items: true,
          cancel_url: `${this.baseURL}/checkout?step=payment_information`,
          line_items: [
            {
              currency: 'PHP',
              amount: total,
              name: 'Order Total',
              quantity: 1,
            },
          ],
          payment_method_types: ['card', 'gcash', 'paymaya', 'dob', 'dob_ubp'],
          success_url: `${this.baseURL}/checkout?step=review_order&success=true`,
        },
      },
    };

    const data = await this.fetchPaymongo({ path: 'checkout_sessions', body });

    const {
      data: {
        attributes: {
          checkout_url,
          payment_intent: {
            id: paymentIntentId,
            attributes: { status },
          },
        },
      },
    } = data;

    return {
      session_data: {
        checkout_url,
        paymentIntentId,
        paymentStatus: status,
      },
    };
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<
    | PaymentProcessorError
    | {
        status: PaymentSessionStatus;
        data: Record<string, unknown>;
      }
  > {
    const paymentIntentId = paymentSessionData.paymentIntentId;
    const paymentIntentData = await this.fetchPaymongo({
      method: 'GET',
      path: `payment_intents/${paymentIntentId}`,
    });

    const {
      data: {
        id,
        attributes: { amount, status, currency },
      },
    } = paymentIntentData;

    const cart = await this.cartService.retrieveWithTotals(
      context.cart_id as string
    );
    const {
      total,
      region: { currency_code: currencyCode },
    } = cart;

    const isValidAmount = amount === total;
    const isValidCurrency = currencyCode === (currency as string).toLowerCase();

    if (status === 'succeeded') {
      console.log('authorize payment ===>>>> ', status);
      if (isValidAmount && isValidCurrency) {
        console.log('authorize payment ===>>>> is inside ', status);

        return {
          status: PaymentSessionStatus.AUTHORIZED,
          data: {
            paymentIntentId: id,
            paymentStatus: status,
          },
        };
      }

      console.log('authorize payment ===>>>> is called outside  ', status);
    }

    console.log(
      'authorize payment ===>>>> is called outside not succeeeded  ',
      status
    );
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const paymentIntentId = paymentSessionData.paymentIntentId;
    const paymentIntentData = await this.fetchPaymongo({
      method: 'GET',
      path: `payment_intents/${paymentIntentId}`,
    });

    if (!paymentIntentData) {
      return PaymentSessionStatus.ERROR;
    }

    const {
      data: {
        id,
        attributes: { status },
      },
    } = paymentIntentData;

    if (status === 'succeeded') {
      console.log('called here', status);
      return PaymentSessionStatus.AUTHORIZED;
    }
    if (status === 'awaiting_next_action') {
      console.log('called here', status);
      return PaymentSessionStatus.PENDING;
    }
    if (status === 'awaiting_payment_method') {
      console.log('called here', status);
      return PaymentSessionStatus.PENDING;
    }
    if (status === 'processing') {
      console.log('called here', status);
      return PaymentSessionStatus.PENDING;
    }

    console.log('called here', status);
    return PaymentSessionStatus.ERROR;
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<Record<string, unknown> | PaymentProcessorError> {
    throw new Error('Method not implemented. refundPayment');
  }

  async retrievePayment(paymentSessionData: {
    paymentIntentId: string;
  }): Promise<Record<string, unknown> | PaymentProcessorError> {
    const paymentIntentId = paymentSessionData.paymentIntentId;
    const paymentIntentData = await this.fetchPaymongo({
      method: 'GET',
      path: `payment_intents/${paymentIntentId}`,
    });

    console.log('retrievePayment ===>>>> is called outside', {
      ...paymentSessionData,
      paymongoData: paymentIntentData.data,
    });

    return {
      ...paymentSessionData,
      paymongoData: paymentIntentData.data,
    };
  }

  async updatePayment(
    context: PaymentProcessorContext
  ): Promise<void | PaymentProcessorError | PaymentProcessorSessionResponse> {
    const paymentIntentId = context.paymentSessionData.paymentIntentId;
    const paymentIntentData = await this.fetchPaymongo({
      method: 'GET',
      path: `payment_intents/${paymentIntentId}`,
    });

    const {
      data: {
        attributes: { status },
      },
    } = paymentIntentData;

    if (status !== 'succeeded') {
      console.log('called here???????????????????????????????????');
      return this.initiatePayment(context);
    }
  }

  async updatePaymentData(
    _: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown> | PaymentProcessorError> {
    return {
      ...data,
    };
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<Record<string, unknown> | PaymentProcessorError> {
    return paymentSessionData;
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<Record<string, unknown> | PaymentProcessorError> {
    return paymentSessionData;
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<Record<string, unknown> | PaymentProcessorError> {
    return paymentSessionData;
  }

  protected buildError(
    message: string,
    e:
      | {
          code?: string;
          detail: string;
        }
      | Error
  ): PaymentProcessorError {
    const errorMessage = 'Paymongo error: ' + message;
    const code = e instanceof Error ? e.message : e.code;
    const detail = e instanceof Error ? e.stack : e.detail;

    return {
      error: errorMessage,
      code: code ?? '',
      detail: detail ?? '',
    };
  }
}

export default PaymongoPaymentService;
