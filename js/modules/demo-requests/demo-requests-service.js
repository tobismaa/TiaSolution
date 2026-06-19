import { getSupabaseClient } from "../../core/supabase-client.js";

async function sha256Hex(value) {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildExpiryDate(days = 7) {
    const expires = new Date();
    expires.setDate(expires.getDate() + days);
    return expires.toISOString();
}

export async function getDemoRequests() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const queryWithToken = supabase
        .from("demo_requests")
        .select(`
            id,
            business_name,
            contact_name,
            email,
            preferred_role,
            status,
            created_at,
            message,
            phone,
            team_size,
            demo_access_links (
                id,
                role,
                token_plain,
                expires_at,
                revoked_at,
                used_at
            )
        `)
        .order("created_at", { ascending: false });

    const { data, error } = await queryWithToken;

    if (error) {
        throw error;
    }

    return data || [];
}

export async function approveDemoRequest(requestId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error } = await supabase
        .from("demo_requests")
        .update({
            status: "approved",
            reviewed_at: new Date().toISOString()
        })
        .eq("id", requestId);

    if (error) {
        throw error;
    }
}

export async function cancelDemoRequest(requestId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error: requestError } = await supabase
        .from("demo_requests")
        .update({
            status: "pending",
            reviewed_at: null
        })
        .eq("id", requestId);

    if (requestError) {
        throw requestError;
    }
}

export async function deleteDemoRequest(requestId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error } = await supabase
        .from("demo_requests")
        .delete()
        .eq("id", requestId);

    if (error) {
        throw error;
    }
}

export async function generateDemoLink(request) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    if (!request?.preferred_role) {
        throw new Error("Missing preferred role for this request.");
    }

    const { data: requestRow, error: requestError } = await supabase
        .from("demo_requests")
        .select("status")
        .eq("id", request.id)
        .maybeSingle();

    if (requestError) {
        throw requestError;
    }

    if (!requestRow || requestRow.status !== "approved") {
        throw new Error("Request must be approved before generating a token.");
    }

    const { data: existingLinks, error: existingLinkError } = await supabase
        .from("demo_access_links")
        .select("id, token_plain")
        .eq("request_id", request.id);

    if (existingLinkError) {
        throw existingLinkError;
    }

    const existingLink = (existingLinks || [])[0];
    if (existingLink?.token_plain) {
        return `${window.location.origin}/demo-access.html?token=${encodeURIComponent(existingLink.token_plain)}`;
    }

    const tokenRole = request.preferred_role === "all_roles" ? "all_roles" : request.preferred_role;
    const roleForInsert = tokenRole === "all_roles" ? "business_admin" : tokenRole;
    const token = `${tokenRole}:${crypto.randomUUID()}${crypto.randomUUID()}`;
    const tokenHash = await sha256Hex(token);
    const expiresAt = buildExpiryDate(7);

    if (existingLink?.id) {
        const { error: updateError } = await supabase
            .from("demo_access_links")
            .update({
                role: roleForInsert,
                token_plain: token,
                token_hash: tokenHash,
                expires_at: expiresAt,
                used_at: null,
                revoked_at: null
            })
            .eq("id", existingLink.id);

        if (updateError) {
            throw updateError;
        }
    } else {
        const { error: insertError } = await supabase.from("demo_access_links").insert({
            request_id: request.id,
            role: roleForInsert,
            token_plain: token,
            token_hash: tokenHash,
            expires_at: expiresAt
        });

        if (insertError) {
            throw insertError;
        }
    }

    return `${window.location.origin}/demo-access.html?token=${encodeURIComponent(token)}`;
}
