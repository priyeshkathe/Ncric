export type MatchType = 'league' | 'semi-final' | 'final';
export type MatchStatus = 'upcoming' | 'completed';

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
}

export interface TournamentState {
    active: boolean;
    name: string;
    teamCount: number;
    teams: Team[];
    matches: Match[];
    playoffs: {
        champion: string | null;
    };
}
