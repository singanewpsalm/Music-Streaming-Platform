import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify the webhook signature (you'll need to set STRIPE_WEBHOOK_SECRET)
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response('Missing stripe signature', { status: 400, headers: corsHeaders })
    }

    const body = await req.text()
    
    // Parse the event (in production, you should verify the signature with Stripe)
    let event
    try {
      event = JSON.parse(body)
    } catch (err) {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders })
    }

    console.log('Received webhook event:', event.type)

    // Handle successful payment
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object
      
      // Extract song_id from metadata (we'll set this when creating the payment)
      const songId = paymentIntent.metadata?.song_id
      const customerEmail = paymentIntent.receipt_email || paymentIntent.customer_details?.email
      
      if (!songId) {
        console.error('No song_id in payment metadata')
        return new Response('Missing song_id in payment metadata', { status: 400, headers: corsHeaders })
      }

      // Update payment status to completed
      const { error: updateError } = await supabase
        .from('payments')
        .update({ 
          payment_status: 'completed',
          stripe_payment_intent_id: paymentIntent.id,
          customer_email: customerEmail,
          updated_at: new Date().toISOString()
        })
        .eq('song_id', songId)
        .eq('payment_status', 'pending')

      if (updateError) {
        console.error('Error updating payment:', updateError)
        return new Response('Error updating payment', { status: 500, headers: corsHeaders })
      }

      // Get the download token for this payment
      const { data: payment, error: fetchError } = await supabase
        .from('payments')
        .select('download_token, songs(title, artist)')
        .eq('song_id', songId)
        .eq('stripe_payment_intent_id', paymentIntent.id)
        .single()

      if (fetchError || !payment) {
        console.error('Error fetching payment:', fetchError)
        return new Response('Payment record not found', { status: 404, headers: corsHeaders })
      }

      // TODO: Send email with download link if you have email service configured
      // For now, we'll redirect to a success page with the download token
      
      console.log(`Payment completed for song. Download token: ${payment.download_token}`)
    }

    return new Response('Webhook processed', { status: 200, headers: corsHeaders })

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response('Webhook error', { status: 500, headers: corsHeaders })
  }
})