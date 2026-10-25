export declare const USER_COGNITIVE_PROFILE_SCHEMA_VERSION: string;
export declare const DOMAIN_CAPABILITY_DIMENSIONS: string[];
export declare function analyzeDomainCapabilities(input?: Record<string, any>): {
  domain: string;
  domainCapabilityProfiles: Array<Record<string, any>>;
  knowledgeDebts: Array<Record<string, any>>;
};
export declare function buildUserCognitiveProfile(input?: Record<string, any>): {
  profile: Record<string, any>;
  domainAnalysis: Record<string, any>;
  priorityInterventions: Array<Record<string, any>>;
};
