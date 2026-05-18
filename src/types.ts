export type MatchType = 'league' | 'semi-final' | 'final';
export type MatchStatus = 'upcoming' | 'completed';

export interface PlayerPerformance {
    playerName: string;
    runs: number;
    wickets: number;
    balls?: number; // Added balls faced
}

export interface Match {
    id: number;
    team1: string;
    team2: string;
    team1Score: number;
    team1Wickets: number;
    team2Score: number;
    team2Wickets: number;
    team1Overs: number;
    team2Overs: number;
    quota: number;
    status: MatchStatus;
    winner: string | 'Tie' | null;
    type: MatchType;
    playerPerformances?: {
        team1Players: PlayerPerformance[];
        team2Players: PlayerPerformance[];
    };
}

export interface Player {
    name: string;
    team: string;
    runs: number;
    wickets: number;
    matches: number;
    balls?: number;
    orangeCaps?: number;
    purpleCaps?: number;
}

export interface RosterPlayer {
    id: string;
    name: string;
    creatorId: string;
    createdAt: number;
    careerRuns?: number;
    careerWickets?: number;
    careerMatches?: number;
    careerBalls?: number;
    orangeCaps?: number;
    purpleCaps?: number;
}

export interface Team {
    name: string;
    played: number;
    won: number;
    lost: number;
    tied: number;
    pts: number;
    runsScored: number;
    oversFaced: number;
    runsConceded: number;
    oversBowled: number;
    nrr: string | number;
    players?: string[]; // List of player names
}

export interface TournamentState {
    id?: string;
    active: boolean;
    name: string;
    teamCount: number;
    teams: Team[];
    matches: Match[];
    playoffs: {
        champion: string | null;
    };
    creatorId?: string;
    creatorEmail?: string;
    createdAt?: number;
    isPublic?: boolean;
    status?: 'live' | 'completed';
    orangeCap?: string;
    purpleCap?: string;
}

export type AppMode = 'timepass' | 'cloud';
