<!--
  UsageTab.svelte — 사용법 (Slice 6 · AC-USAGE-TAB + AC-KOREAN-UI)
  ---------------------------------------------------------------
  로그인-피드백 사이에 놓이는 사용법 탭. 대상은 AI·IT를 잘 모르는 일반인(20-40대).
  네 단계(원서 넣기 → 후보 자동 추출 → ChatGPT로 정리 → 위키 검토·저장)를
  친근한 한글로 안내한다. 전문용어·내부 jargon은 최소화하고, 꼭 필요한 곳에만
  쉬운 풀이를 붙인다.

  설계: 단계마다 큰 번호 + 짧은 제목 + 한두 문장 설명. 색상에만 의존하지 않도록
  번호 원형은 텍스트(①②③④) + 테두리로 구분된다(접근성). 토큰만 사용한다.

  이 탭은 어떤 인증도 필요 없고, 어떤 데이터도 바꾸지 않는다(읽기 전용 안내).
-->
<script lang="ts">
  // 순수 안내 화면 — 상태/네트워크/저장 없음.
  const steps = [
    {
      n: '①',
      title: '먼저 “목차(스키마)”를 입력하기',
      body:
        '정리할 논문이나 자료의 목차를 [메인] 화면에 먼저 넣어 주세요. 목차가 있으면 뒤에서 뽑은 후보들이 논문 작성 순서대로 묶여서, “이 내용은 2.2장 후반부에 쓰겠다”처럼 훨씬 쉽게 판단할 수 있습니다.',
    },
    {
      n: '②',
      title: '원서(읽을 책·자료)를 넣기',
      body:
        'PDF, txt, md 파일을 [메인] 화면에 끌어다 놓거나 [파일 선택]으로 고릅니다. 여러 문헌을 넣으면 하나의 후보 풀로 묶이고, 같은 PDF를 다시 넣으면 앱이 중복으로 알려 줍니다.',
    },
    {
      n: '③',
      title: '후보를 자동으로 뽑기 (목차 기준으로 분류)',
      body:
        '앱이 원문에서 중요한 개념·주장·반론·방법론 후보를 카드로 보여 줍니다. 이 단계는 인터넷 없이도 동작하며, 카드에서는 [주요주장]과 [본문근거]를 나누어 확인할 수 있습니다.',
    },
    {
      n: '④',
      title: 'ChatGPT로 정리하기 (두 가지 방법)',
      body: null, // 이 단계는 아래 두 갈래로 나눠 설명
    },
    {
      n: '⑤',
      title: '위키를 검토하고 저장하기',
      body:
        '필요한 후보만 위키로 가져온 뒤 [위키] 화면에서 목차별 또는 문헌별로 확인합니다. 항목을 고쳐 쓴 뒤 저장하면 내 컴퓨터의 위키 자료로 남습니다.',
    },
  ];
</script>

<section class="usage">
  <header class="intro">
    <h2 class="section-title">사용법 — 처음 쓰는 분께</h2>
    <p class="section-lede">
      이 앱은 책·논문에서 논문 작성에 쓸 만한 내용을 뽑아, 목차별·문헌별로 다시
      찾아볼 수 있는 위키로 정리합니다. 기본 기능은 로그인 없이 쓸 수 있고, 자동
      LLM 모드는 원하는 사람만 따로 설정하면 됩니다.
    </p>

    <!-- AC-USAGE-OUTLINE-FIRST: 목차/스키마를 먼저 입력하라는 안내를 눈에 띄게. -->
    <p class="outline-first" role="note">
      <strong>가장 먼저 “목차(스키마)”를 입력하세요.</strong>
      목차를 먼저 넣으면 후보가 논문 작성 순서대로 정렬됩니다. 나중에 문헌별로도
      볼 수 있지만, 글을 쓸 때는 목차별 보기가 기준이 됩니다.
      <span class="outline-flow">목차 입력 → 원서 넣기 → 후보 추출 → ChatGPT 정리 → 위키 검토·저장</span>
    </p>

    <div class="mode-guide" role="note" aria-label="복붙 모드와 자동 모드 차이">
      <h3 class="mode-guide-title">먼저 이렇게 고르면 됩니다</h3>
      <div class="mode-guide-grid">
        <section class="mode-guide-card">
          <h4>처음 쓰는 분</h4>
          <strong>복붙 모드</strong>
          <p>설치 없이 시작합니다. 앱이 만든 프롬프트를 ChatGPT에 붙여넣고, 답을 다시 앱에 붙여넣어 검증합니다.</p>
        </section>
        <section class="mode-guide-card">
          <h4>자동으로 돌리고 싶은 분</h4>
          <strong>자동 LLM 모드</strong>
          <p>Codex CLI 로그인 상태가 필요합니다. Codex 앱 설치는 필수가 아니지만, CLI 로그인이 정상이어야 합니다.</p>
        </section>
      </div>
    </div>
  </header>

  <ol class="step-list" role="list">
    {#each steps as step (step.n)}
      <li class="step">
        <span class="step-num" aria-hidden="true">{step.n}</span>
        <div class="step-text">
          <h3 class="step-title">{step.title}</h3>
          {#if step.body}
            <p class="step-body">{step.body}</p>
          {:else}
            <!-- ③ 단계: 복붙 방식(기본) / 자동 방식(로그인 시) 두 갈래 -->
            <p class="step-body">
              뽑은 후보를 논문용 카드로 다듬을 때 ChatGPT를 쓸 수 있습니다.
              방법은 두 가지지만, <strong>근거 검증 흐름은 같습니다.</strong>
            </p>

            <div class="branch" data-kind="paste">
              <h4 class="branch-title">방법 A · 복사해서 붙여넣기 <span class="branch-tag">기본 · 누구나</span></h4>
              <ol class="branch-steps" role="list">
                <li>먼저 [규칙 기반 후보 추출(오프라인)]을 눌러 후보 카드를 봅니다.</li>
                <li>한 후보는 [ChatGPT 브릿지 열기], 여러 후보는 [상위 후보 일괄 ChatGPT 브릿지]를 누릅니다.</li>
                <li>브릿지 안의 [프롬프트 복사]를 누르고, 웹브라우저에서 <code>chatgpt.com</code>에 붙여넣어 보냅니다.</li>
                <li>ChatGPT가 돌려준 JSON을 브릿지 입력칸에 붙여넣고 [검증]을 누릅니다.</li>
                <li>검증을 통과한 후보만 [가져오기]로 위키 초안에 넣습니다.</li>
              </ol>
              <p class="branch-note">
                책 전체를 통째로 보내는 방식이 아니라, 선택한 후보와 근거만 보내는 방식입니다.
              </p>
            </div>

            <div class="branch" data-kind="auto">
              <h4 class="branch-title">방법 B · 자동으로 처리 <span class="branch-tag">선택 · 로그인하면</span></h4>
              <p class="branch-note">
                PowerShell에서 Codex CLI를 설치하고 로그인하면 앱이 ChatGPT 왕복 과정을
                자동으로 처리할 수 있습니다. Codex 앱 설치는 필수가 아니지만,
                <code>codex login status</code>가 정상이어야 합니다.
              </p>
              <ul class="branch-checks" aria-label="자동 모드에서 앱이 하지 않는 일">
                <li>앱은 Codex를 자동 설치하지 않습니다.</li>
                <li>각자 자기 ChatGPT 계정으로 로그인합니다.</li>
                <li>아이디·비밀번호와 인증 파일 내용은 앱에 입력하지 않습니다.</li>
              </ul>
              <p class="branch-note">
                자동 모드가 안 되면 먼저 PowerShell에서 <code>codex login status</code>를
                확인하세요. 로그인 전이면 <code>codex login</code>, 브라우저가 안 열리면
                <code>codex login --device-auth</code>를 쓰면 됩니다.
              </p>
              <p class="branch-note muted">
                이 방법은 선택 사항이에요. 로그인하지 않아도 <strong>방법 A</strong>로
                같은 검증 흐름을 수동으로 쓸 수 있습니다.
              </p>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  <!-- AC-USAGE-AUTO-SETUP (Slice 9): 자동 모드를 쓰고 싶은 사람을 위한 1회 설정법.
       기본 복붙(방법 A)과 분리된 별도의 '고급' 섹션이다. 일반인도 따라 할 수 있게
       PowerShell 명령을 그대로 적어 둔다. codex 설치·로그인은 사용자가 직접 한다
       (앱은 검출·안내만; 강요하지 않음). -->
  <section class="auto-setup" aria-labelledby="auto-setup-title">
    <h3 id="auto-setup-title" class="auto-setup-title">
      자동 모드 설정법 <span class="auto-setup-tag">고급 · 선택</span>
    </h3>
    <p class="auto-setup-lede">
      자동 모드는 선택 기능입니다. 복붙이 번거로울 때만 아래 순서로 한 번 설정하세요.
      핵심은 간단합니다: <strong>Node.js 확인 → Codex CLI 설치 → Codex 로그인 상태 확인 → 앱에서 다시 검출</strong>.
    </p>

    <div class="auto-boundary" role="note" aria-label="자동 모드에서 앱과 사용자가 하는 일">
      <div>
        <span class="boundary-kicker">사용자가 하는 일</span>
        <strong>PowerShell에서 설치·로그인</strong>
        <p>각자 자기 컴퓨터에서 자기 ChatGPT 계정으로 한 번 설정합니다.</p>
      </div>
      <div>
        <span class="boundary-kicker">앱이 하는 일</span>
        <strong>상태 검출 · 자동 요청</strong>
        <p>로그인 상태가 확인된 PC에서만 자동 모드를 켭니다.</p>
      </div>
      <div>
        <span class="boundary-kicker">앱이 하지 않는 일</span>
        <strong>설치 대행 · 비밀번호 보관</strong>
        <p>Codex 앱 설치는 필수가 아니고, 앱이 인증 내용을 만들거나 가져가지 않습니다.</p>
      </div>
    </div>

    <ol class="auto-steps" role="list">
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">1</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">PowerShell(파워셸) 열기</h4>
          <p class="auto-step-body">
            윈도우 시작 메뉴에서 <strong>PowerShell</strong>을 검색해 엽니다. 아래 명령은 모두 여기에서 입력합니다.
          </p>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">2</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">Node.js가 있는지 확인하기</h4>
          <p class="auto-step-body">
            둘 다 버전 번호가 나오면 다음 단계로 갑니다.
          </p>
          <pre class="auto-cmd"><code>node -v
npm -v</code></pre>
          <p class="auto-step-body">
            “인식할 수 없습니다”가 나오면 Node.js LTS를 설치하고 PowerShell을 새로 여세요.
            <a class="auto-link" href="https://nodejs.org/ko" target="_blank" rel="noreferrer noopener">nodejs.org/ko</a>
          </p>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">3</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">codex(코덱스) 설치하기</h4>
          <p class="auto-step-body">
            아래 한 줄을 입력해 Codex CLI를 설치합니다. 앱이 대신 설치하지는 않습니다.
          </p>
          <pre class="auto-cmd"><code>npm i -g &#64;openai/codex</code></pre>
          <p class="auto-step-body">
            설치 후 버전이 나오면 정상입니다.
          </p>
          <pre class="auto-cmd"><code>codex --version</code></pre>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">4</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">내 ChatGPT 계정으로 로그인하기</h4>
          <p class="auto-step-body">
            먼저 상태를 확인합니다. 로그인되어 있지 않다면 <code>codex login</code>을 실행하세요.
          </p>
          <pre class="auto-cmd"><code>codex login status</code></pre>
          <p class="auto-step-body">
            로그인 전이라고 나오면 아래 명령으로 로그인합니다.
          </p>
          <pre class="auto-cmd"><code>codex login</code></pre>
          <p class="auto-step-body">
            브라우저 로그인이 열리지 않으면 아래 명령을 쓰면 됩니다.
          </p>
          <pre class="auto-cmd"><code>codex login --device-auth</code></pre>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">5</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">앱에서 자동 모드 켜기</h4>
          <p class="auto-step-body">
            앱의 [로그인] 화면에서 <strong>[다시 검출]</strong>을 누릅니다.
            “자동 모드 사용 가능”으로 바뀌면 [추출 모드]에서 <strong>자동 LLM 모드</strong>를 고를 수 있습니다.
          </p>
          <p class="auto-step-body">
            처음 실행할 때는 자동 연결 도구를 내려받느라 잠시 멈춘 것처럼 보일 수 있습니다.
            실패해도 복붙 모드로 계속 진행할 수 있습니다.
          </p>
        </div>
      </li>
    </ol>

    <div class="auto-trouble" role="note" aria-label="자동 모드가 막힐 때 확인할 것">
      <h4 class="auto-trouble-title">막히면 여기부터 확인하세요</h4>
      <ul class="auto-check-list">
        <li><code>node -v</code>, <code>npm -v</code>가 안 나오면 Node.js LTS를 설치한 뒤 PowerShell을 새로 엽니다.</li>
        <li><code>codex --version</code>이 안 나오면 <code>npm i -g &#64;openai/codex</code> 설치가 끝났는지 확인합니다.</li>
        <li><code>codex login status</code>가 로그인 전이면 <code>codex login</code> 또는 <code>codex login --device-auth</code>를 실행합니다.</li>
        <li>PowerShell에서는 정상인데 앱이 못 찾으면 [다시 검출]을 누르거나 앱을 재시작합니다.</li>
        <li>로그인은 정상인데 자동 연결만 실패하면 Node.js/npx, 방화벽, 회사망을 확인하고 복붙 모드로 계속 진행합니다.</li>
      </ul>
    </div>

    <p class="auto-setup-note" role="note">
      자동 모드는 편의 기능입니다. 설정이 어렵거나 연결이 불안정하면
      <strong>방법 A(후보별 복붙)</strong>로 같은 검증 흐름을 계속 사용할 수 있습니다.
    </p>
  </section>

  <footer class="outro" role="note">
    막히는 부분이 있으면 [피드백] 화면으로 편하게 알려 주세요. 로그인 없이 보낼 수
    있습니다.
  </footer>
</section>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .section-title {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    margin: 0;
  }

  .section-lede {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  /* AC-USAGE-OUTLINE-FIRST: 목차 먼저 안내 콜아웃. 토큰만 사용. */
  .outline-first {
    margin: var(--space-sm) 0 0 0;
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.65;
    padding: var(--space-md);
    border: 1px solid var(--accent-oxblood);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-soft);
    background: var(--surface-elevated);
  }
  .outline-flow {
    display: block;
    margin-top: var(--space-xs);
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--accent-oxblood);
  }

  .mode-guide {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-sunken);
  }

  .mode-guide-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .mode-guide-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-sm);
  }

  .mode-guide-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-elevated);
  }

  .mode-guide-card h4,
  .mode-guide-card p {
    margin: 0;
  }

  .mode-guide-card h4 {
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-secondary);
  }

  .mode-guide-card strong {
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    color: var(--accent-oxblood);
  }

  .mode-guide-card p {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .step-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .step {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-md);
    align-items: start;
    padding: var(--space-lg);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
  }

  .step-num {
    font-family: var(--heading-family);
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--accent-oxblood);
    width: 1.6em;
    text-align: center;
  }

  .step-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .step-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .step-body {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.65;
  }

  .branch {
    margin-top: var(--space-sm);
    padding: var(--space-md) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-sunken);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .branch[data-kind='auto'] {
    border-style: dashed;
  }

  .branch-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .branch-tag {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .branch-steps {
    margin: var(--space-xs) 0 0 0;
    padding-left: 1.3em;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .branch-note {
    margin: var(--space-xs) 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .branch-note.muted {
    color: var(--text-secondary);
    opacity: 0.9;
  }

  .branch-checks {
    margin: var(--space-xs) 0 0 0;
    padding: var(--space-sm) var(--space-md) var(--space-sm) 1.45rem;
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-base);
    border-radius: var(--radius-tight);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  /* AC-USAGE-AUTO-SETUP (Slice 9): 고급 자동 모드 설정 섹션. 기본 단계와
     시각적으로 구분되도록 점선 테두리 + 별도 헤더. 토큰만 사용. */
  .auto-setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    border: 1px dashed var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-sunken);
  }

  .auto-setup-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .auto-setup-tag {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--accent-oxblood);
    color: var(--accent-oxblood);
  }

  .auto-setup-lede {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.65;
  }

  .auto-boundary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-sm);
  }

  .auto-boundary > div {
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-elevated);
  }

  .boundary-kicker {
    display: block;
    margin-bottom: var(--space-xs);
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--text-secondary);
  }

  .auto-boundary strong {
    display: block;
    font-family: var(--heading-family);
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .auto-boundary p {
    margin: var(--space-xs) 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .auto-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .auto-step {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-md);
    align-items: start;
  }

  .auto-step-num {
    font-family: var(--heading-family);
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.4;
    color: var(--accent-oxblood);
    width: 1.6em;
    height: 1.6em;
    text-align: center;
    border: 1px solid var(--accent-oxblood);
    border-radius: var(--radius-pill);
  }

  .auto-step-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .auto-step-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .auto-step-body {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .auto-link {
    color: var(--accent-oxblood);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .auto-cmd {
    margin: var(--space-xs) 0 0 0;
    padding: var(--space-sm) var(--space-md);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    overflow-x: auto;
  }

  .auto-cmd code {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .auto-trouble {
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--warn-amber);
    border-radius: var(--radius-tight);
    background: var(--surface-elevated);
  }

  .auto-trouble-title {
    margin: 0 0 var(--space-xs) 0;
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .auto-check-list {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .auto-setup-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-elevated);
    border-radius: var(--radius-tight);
  }

  .outro {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-base);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
