import React from 'react';

interface PlatformIconProps {
  platform?: string | null;
  className?: string;
  size?: number;
}

export const TikTokIcon: React.FC<{ className?: string; size?: number }> = ({
  className = 'w-5 h-5',
  size,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
    aria-label="TikTok"
  >
    <rect width="24" height="24" rx="5" fill="#000000" />
    {/* Cyan offset shadow */}
    <path
      d="M12.525 2.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      fill="#25F4EE"
      transform="translate(-0.8, -0.6)"
    />
    {/* Magenta/Red offset shadow */}
    <path
      d="M12.525 2.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      fill="#FE2C55"
      transform="translate(0.8, 0.6)"
    />
    {/* White main note */}
    <path
      d="M12.525 2.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      fill="#FFFFFF"
    />
  </svg>
);

export const YouTubeIcon: React.FC<{ className?: string; size?: number }> = ({
  className = 'w-5 h-5',
  size,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
    aria-label="YouTube"
  >
    {/* Red YouTube rounded rectangle */}
    <path
      d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
      fill="#FF0000"
    />
    {/* White play triangle */}
    <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFFFFF" />
  </svg>
);

export const FacebookIcon: React.FC<{ className?: string; size?: number }> = ({
  className = 'w-5 h-5',
  size,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
    aria-label="Facebook"
  >
    {/* Facebook Blue Circle */}
    <circle cx="12" cy="12" r="12" fill="#1877F2" />
    {/* White 'f' letter */}
    <path
      d="M15.12 12.88l.45-3.03h-2.9v-1.97c0-.83.4-1.63 1.7-1.63h1.32V3.67c-.24-.03-1.07-.1-2.04-.1-2.08 0-3.44 1.26-3.44 3.55v2.73H7.6v3.03h2.61V22h3.21v-9.12h1.7z"
      fill="#FFFFFF"
    />
  </svg>
);

export const InstagramIcon: React.FC<{ className?: string; size?: number }> = ({
  className = 'w-5 h-5',
  size,
}) => (
  <svg
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={size ? { width: size, height: size } : undefined}
    aria-label="Instagram"
  >
    <defs>
      <radialGradient id="ig-rg1-aw" cx="19.38%" cy="99.38%" r="109.52%" fx="19.38%" fy="99.38%">
        <stop offset="0%" stopColor="#FFD600" />
        <stop offset="50%" stopColor="#FF0100" />
        <stop offset="100%" stopColor="#D800B9" />
      </radialGradient>
      <radialGradient id="ig-rg2-aw" cx="11.44%" cy="0.98%" r="150.75%" fx="11.44%" fy="0.98%">
        <stop offset="0%" stopColor="#0064E1" />
        <stop offset="50%" stopColor="#0064E1" stopOpacity="0" />
        <stop offset="100%" stopColor="#0064E1" stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect width="24" height="24" rx="6" fill="url(#ig-rg1-aw)" />
    <rect width="24" height="24" rx="6" fill="url(#ig-rg2-aw)" />
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.2" stroke="white" strokeWidth="1.5" fill="none" />
    <circle cx="12" cy="12" r="3.4" stroke="white" strokeWidth="1.5" fill="none" />
    <circle cx="17" cy="7" r="1.1" fill="white" />
  </svg>
);

export const PlatformIcon: React.FC<PlatformIconProps> = ({
  platform,
  className = 'w-5 h-5',
  size,
}) => {
  const norm = (platform || '').toLowerCase().trim();

  if (norm === 'tiktok') {
    return <TikTokIcon className={className} size={size} />;
  }

  if (norm === 'youtube') {
    return <YouTubeIcon className={className} size={size} />;
  }

  if (norm === 'facebook') {
    return <FacebookIcon className={className} size={size} />;
  }

  if (norm === 'instagram') {
    return <InstagramIcon className={className} size={size} />;
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={size ? { width: size, height: size, fontSize: size * 0.7 } : undefined}
    >
      📱
    </span>
  );
};
