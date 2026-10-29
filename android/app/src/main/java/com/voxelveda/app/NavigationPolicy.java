package com.voxelveda.app;

import java.net.URI;

/** Exact first-party trust boundary. Never log a URL query, fragment or credentials. */
public final class NavigationPolicy {
    public static final String ORIGIN = "https://app.voxelveda.com";
    public static final String HOST = "app.voxelveda.com";
    public static final String LEGACY_HOST = "voxelveda-app-production.up.railway.app";

    public static boolean isApplication(String value) {
        URI uri = parse(value);
        return uri != null && HOST.equalsIgnoreCase(uri.getHost());
    }

    public static String canonical(String value) {
        URI uri = parse(value);
        if (uri == null || !(HOST.equalsIgnoreCase(uri.getHost()) || LEGACY_HOST.equalsIgnoreCase(uri.getHost()))) return null;
        String path = uri.getRawPath();
        if (path == null || path.isEmpty()) path = "/";
        if (path.startsWith("//") || path.contains("\\")) return null;
        return ORIGIN + path + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()) + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
    }

    /** A newly created window may start blank before its first real destination. */
    public static boolean isPopupPlaceholder(String value) {
        return value == null || value.isEmpty() || "about:blank".equals(value) || value.startsWith("about:blank#");
    }

    private static URI parse(String value) {
        try {
            if (value == null || value.chars().anyMatch(c -> c <= 32 || c == '\\')) return null;
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
            return uri;
        } catch (Exception ignored) { return null; }
    }

    private NavigationPolicy() {}
}
