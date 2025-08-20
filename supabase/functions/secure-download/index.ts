import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return new Response('Missing download token', { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify the download token and get song details
    const { data: verificationResult, error: verifyError } = await supabase
      .rpc('verify_download_token', { token })
      .single()

    if (verifyError || !verificationResult?.valid) {
      return new Response('Invalid or expired download token', { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get the signed URL for the file
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('songs')
      .createSignedUrl(verificationResult.file_path, 300) // 5 minute expiry

    if (urlError || !signedUrlData?.signedUrl) {
      console.error('Error creating signed URL:', urlError)
      return new Response('Error accessing file', { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Return the signed URL for download
    return new Response(JSON.stringify({
      success: true,
      downloadUrl: signedUrlData.signedUrl,
      songTitle: verificationResult.song_title,
      songArtist: verificationResult.song_artist,
      downloadsRemaining: verificationResult.downloads_remaining
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Download error:', error)
    return new Response('Internal server error', { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})