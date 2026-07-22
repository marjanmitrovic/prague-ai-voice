import { describe, expect, it } from 'vitest';
import { createLocalAssistantText } from '../src/ai/local-business-agent.js';
import { getBusinessProfile, publicBusinessProfile } from '../src/business/business-profile.js';

describe('business profile agent', () => {
  it('loads public business profile from JSON', () => {
    const profile = publicBusinessProfile(getBusinessProfile());
    expect(profile.companyName).toBe('Studio Aurora Praha');
    expect(profile.services.length).toBeGreaterThanOrEqual(3);
  });

  it('answers service price from JSON profile', () => {
    const result = createLocalAssistantText('Kolik stojí úprava obočí?');
    expect(result.intent).toBe('service_price');
    expect(result.text).toContain('tři sta padesát korun');
  });

  it('answers opening hours from JSON profile', () => {
    const result = createLocalAssistantText('Kdy máte otevřeno?');
    expect(result.intent).toBe('opening_hours');
    expect(result.text).toContain('pondělí až pátek');
  });

  it('offers supported topics in fallback response', () => {
    const result = createLocalAssistantText('Prodáváte dárkové poukazy?');
    expect(result.intent).toBe('fallback_with_supported_topics');
    expect(result.text).toContain('vytvořením rezervace');
  });

  it('explains booking help through conversation', () => {
    const result = createLocalAssistantText('Chci si rezervovat termín.');
    expect(result.intent).toBe('booking_help');
    expect(result.text).toContain('Rezervaci mohu připravit');
  });

});
