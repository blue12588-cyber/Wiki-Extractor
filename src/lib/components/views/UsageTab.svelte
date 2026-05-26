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
        '무엇보다 먼저, 정리할 책·자료의 목차나 큰 항목 틀(스키마)을 [메인] 화면에 입력해 주세요. 예를 들어 “1장 서론 / 2장 배경 / 3장 핵심 주장 …”처럼요. 목차를 먼저 정해 두면, 다음 단계에서 뽑은 후보들이 그 목차에 맞춰 분류되어 훨씬 정돈된 위키가 됩니다. (목차 없이도 쓸 수 있지만, 먼저 넣는 편을 권합니다.)',
    },
    {
      n: '②',
      title: '원서(읽을 책·자료)를 넣기',
      body:
        '정리하고 싶은 책이나 자료 파일을 [메인] 화면으로 끌어다 놓거나, [파일 선택]으로 고릅니다. PDF, 일반 텍스트(.txt), 마크다운(.md) 파일을 넣을 수 있어요. 여러 파일을 한 번에 넣으면 앱이 차례로 처리해 하나의 후보 풀로 묶습니다. 파일은 내 컴퓨터 안에서만 다뤄집니다.',
    },
    {
      n: '③',
      title: '후보를 자동으로 뽑기 (목차 기준으로 분류)',
      body:
        '파일을 넣으면 앱이 긴 내용을 읽기 좋은 크기로 잘게 나눠, 위키로 만들 만한 “후보”(중요한 개념·주장·인물 등)를 스스로 찾아 카드로 보여 줍니다. ①에서 넣은 목차가 있으면 후보들이 그 목차 항목에 맞춰 분류됩니다. 이 단계는 인터넷 없이도 동작합니다.',
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
        '정리된 후보 카드를 하나씩 보면서 [승인]·[보류]·[폐기]를 고릅니다. 내용이 마음에 안 들면 직접 고쳐 쓸 수도 있어요. 승인한 항목만 내 위키에 저장되고, 나중에 [위키] 화면에서 다시 보고 편집할 수 있습니다.',
    },
  ];
</script>

<section class="usage">
  <header class="intro">
    <h2 class="section-title">사용법 — 처음 쓰는 분께</h2>
    <p class="section-lede">
      이 앱은 읽은 책·자료에서 중요한 내용을 뽑아 나만의 “위키”(쉽게 말해, 정리된
      메모 모음)로 만들어 줍니다. 아래 다섯 단계만 따라 하면 됩니다. 어려운 설정이나
      가입은 필요 없어요.
    </p>

    <!-- AC-USAGE-OUTLINE-FIRST: 목차/스키마를 먼저 입력하라는 안내를 눈에 띄게. -->
    <p class="outline-first" role="note">
      <strong>가장 먼저 “목차(스키마)”를 입력하세요.</strong>
      정리할 책·자료의 목차나 큰 틀을 [메인] 화면에 먼저 넣어 두면, 뒤에서 뽑은
      내용이 그 목차에 맞춰 분류되어 훨씬 깔끔한 위키가 됩니다. 순서는 아래와 같아요:
      <span class="outline-flow">목차 입력 → 원서 넣기 → 후보 추출 → ChatGPT 정리 → 위키 검토·저장</span>
    </p>

    <div class="mode-guide" role="note" aria-label="복붙 모드와 자동 모드 차이">
      <h3 class="mode-guide-title">먼저 이렇게 고르면 됩니다</h3>
      <div class="mode-guide-grid">
        <section class="mode-guide-card">
          <h4>처음 쓰는 분</h4>
          <strong>복붙 모드</strong>
          <p>설치 없이 시작합니다. 먼저 오프라인 후보를 만든 뒤, 필요한 후보 카드에서 ChatGPT 브릿지를 열어 답을 붙여넣고 검증합니다.</p>
        </section>
        <section class="mode-guide-card">
          <h4>자동으로 돌리고 싶은 분</h4>
          <strong>자동 LLM 모드</strong>
          <p>Codex CLI를 직접 설치하고 자기 ChatGPT 계정으로 로그인해야 합니다. 앱은 설치를 대신하지 않고, 인증 파일도 만들지 않습니다.</p>
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
              뽑은 후보를 더 깔끔하게 다듬으려면 ChatGPT의 도움을 받습니다.
              방법은 두 가지이고, <strong>근거 검증 기준은 같습니다.</strong>
            </p>

            <div class="branch" data-kind="paste">
              <h4 class="branch-title">방법 A · 복사해서 붙여넣기 <span class="branch-tag">기본 · 누구나</span></h4>
              <ol class="branch-steps" role="list">
                <li>먼저 [규칙 기반 후보 추출(오프라인)]을 눌러 후보 카드를 봅니다.</li>
                <li>여러 후보를 한 번에 정리하려면 [상위 후보 일괄 ChatGPT 브릿지]를 누릅니다. 한 후보만 보내고 싶으면 해당 카드의 [ChatGPT 브릿지 열기]를 누릅니다.</li>
                <li>브릿지 안의 [프롬프트 복사]를 누르고, 웹브라우저에서 <code>chatgpt.com</code>에 붙여넣어 보냅니다.</li>
                <li>ChatGPT가 돌려준 JSON을 브릿지 입력칸에 붙여넣고 [검증]을 누릅니다.</li>
                <li>검증을 통과한 후보만 [가져오기]로 위키 초안에 넣습니다.</li>
              </ol>
              <p class="branch-note">
                이 방법은 책 전체를 통째로 보내는 방식이 아니라, 앱이 먼저 고른
                상위 후보와 그 근거 청크만 묶어 보내는 기본 방법입니다.
              </p>
            </div>

            <div class="branch" data-kind="auto">
              <h4 class="branch-title">방법 B · 자동으로 처리 <span class="branch-tag">선택 · 로그인하면</span></h4>
              <p class="branch-note">
                <strong>Codex CLI를 설치한 뒤</strong> [로그인] 화면에서
                <strong>[ChatGPT로 로그인]</strong> 버튼을 누르면, 후보 추출과 LLM 정리
                과정을 앱이 자동으로 처리할 수 있습니다. 버튼을 누르면 앱이 먼저
                로그인 상태를 확인하고, <strong>이미 로그인돼 있으면</strong> 브라우저를
                열지 않고 바로 자동 모드를 켭니다(정상이에요). 아직 로그인 전이면
                로그인 페이지와 <strong>짧은 코드</strong>를 보여 줍니다.
              </p>
              <ul class="branch-checks" aria-label="자동 모드에서 앱이 하지 않는 일">
                <li>Codex CLI 설치는 사용자가 직접 합니다.</li>
                <li>각 사용자 PC에서 자기 ChatGPT 계정으로 로그인합니다.</li>
                <li>아이디·비밀번호와 인증 파일은 앱이 만들거나 가져가지 않습니다.</li>
              </ul>
              <p class="branch-note">
                로그인 페이지가 자동으로 열리지 않는 환경(회사·학교 방화벽, 원격 접속
                등)에서도, 화면에 뜬 주소 옆 <strong>[주소 열기]</strong> 버튼이나
                주소를 직접 입력해 로그인을 마칠 수 있습니다. 코드 입력 방식이 막힌
                드문 경우에는 <strong>[브라우저 자동 열기 방식으로 다시 시도]</strong>를
                눌러 보세요.
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
      위 <strong>방법 A(후보별 복사·붙여넣기)</strong>만으로도 후보 정리와 검증을
      할 수 있습니다. 후보마다 복사·붙여넣기 하기가 번거롭다면, 아래 설정을
      <strong>한 번만</strong> 해 두면 앱이 알아서 ChatGPT에게 물어보고 결과를
      받아오는 <strong>자동 모드</strong>를 켤 수 있어요. 단, Codex 설치와 로그인은
      사용자가 직접 합니다. 자동 모드는 내 ChatGPT 계정(무료 또는 구독)으로 동작하며,
      사용량도 내 계정 기준입니다.
    </p>

    <div class="auto-boundary" role="note" aria-label="자동 모드에서 앱과 사용자가 하는 일">
      <div>
        <span class="boundary-kicker">사용자가 하는 일</span>
        <strong>Node.js 설치 · Codex 설치 · ChatGPT 로그인</strong>
        <p>각자 자기 컴퓨터에서 한 번만 설정합니다. 다른 사람이 앱을 받으면 그 사람 계정으로 다시 해야 합니다.</p>
      </div>
      <div>
        <span class="boundary-kicker">앱이 하는 일</span>
        <strong>로그인 상태 검출 · 자동 요청</strong>
        <p>설정이 끝난 PC에서만 자동 모드를 켭니다. 실패하면 복붙 모드로 계속 사용할 수 있습니다.</p>
      </div>
      <div>
        <span class="boundary-kicker">앱이 하지 않는 일</span>
        <strong>Codex 자동 설치 · 인증파일 생성</strong>
        <p>비밀번호를 받지 않고, <code>auth.json</code>을 만들거나 배포하지 않습니다.</p>
      </div>
    </div>

    <ol class="auto-steps" role="list">
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">1</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">PowerShell(파워셸) 열기</h4>
          <p class="auto-step-body">
            윈도우 시작 메뉴에서 <strong>“PowerShell”</strong>을 검색해 엽니다.
            검은(또는 파란) 명령 입력 창이 뜨면 준비된 거예요.
          </p>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">2</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">Node.js가 있는지 확인하기</h4>
          <p class="auto-step-body">
            아래 두 줄을 차례로 입력합니다. 둘 다 <code>v20...</code>, <code>10...</code>처럼
            버전 번호가 나오면 다음 단계로 가면 됩니다.
          </p>
          <pre class="auto-cmd"><code>node -v
npm -v</code></pre>
          <p class="auto-step-body">
            “인식할 수 없습니다”처럼 나오면 Node.js가 없는 상태입니다.
            <a class="auto-link" href="https://nodejs.org/ko" target="_blank" rel="noreferrer noopener">nodejs.org/ko</a>
            에서 <strong>LTS</strong> 버전을 설치한 뒤, PowerShell을 닫았다가 다시 열고
            위 확인 명령을 다시 입력하세요.
          </p>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">3</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">codex(코덱스) 설치하기</h4>
          <p class="auto-step-body">
            Node.js 확인이 끝났으면 아래 한 줄을 그대로 입력하고 <kbd>Enter</kbd>를 누릅니다.
            설치는 이 앱이 대신 하지 않습니다.
          </p>
          <pre class="auto-cmd"><code>npm i -g &#64;openai/codex</code></pre>
          <p class="auto-step-body">
            설치가 끝나면 아래 명령으로 codex가 잡히는지 확인합니다. 버전이나 도움말이
            나오면 정상입니다.
          </p>
          <pre class="auto-cmd"><code>codex --version</code></pre>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">4</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">내 ChatGPT 계정으로 로그인하기</h4>
          <p class="auto-step-body">
            아래 명령을 입력하거나, 앱의 [로그인] 화면에서
            <strong>[ChatGPT로 로그인]</strong>을 누릅니다. 웹브라우저가 열리거나
            화면에 짧은 코드가 나오면, 평소 쓰던 ChatGPT 계정으로 로그인하면 됩니다
            (무료/구독 계정 모두 가능). 아이디·비밀번호는 이 앱에 입력하지 않습니다.
          </p>
          <pre class="auto-cmd"><code>codex login</code></pre>
          <p class="auto-step-body">
            로그인 후에는 아래 명령으로 상태를 확인할 수 있습니다. 이미 로그인되어
            있으면 “logged in” 또는 그에 준하는 안내가 나옵니다.
          </p>
          <pre class="auto-cmd"><code>codex login status</code></pre>
        </div>
      </li>
      <li class="auto-step">
        <span class="auto-step-num" aria-hidden="true">5</span>
        <div class="auto-step-text">
          <h4 class="auto-step-title">앱에서 자동 모드 켜기</h4>
          <p class="auto-step-body">
            한 번 로그인해 두면 이 앱이 자동으로 인식합니다. 앱의 [로그인] 화면에서
            <strong>[다시 검출]</strong>을 누르면 “자동 모드 사용 가능”으로 바뀌고,
            [추출 모드]에서 <strong>자동 LLM 모드</strong>를 고를 수 있게 됩니다. 이
            한 번의 설정 뒤로는 복사·붙여넣기 없이 바로 자동으로 정리돼요.
          </p>
          <p class="auto-step-body">
            자동 모드를 처음 실행할 때는 자동 연결 도구를 내려받느라
            30초에서 1분 정도 멈춘 것처럼 보일 수 있습니다. 실패해도 앱은 꺼지지
            않고, 언제든 복붙 모드로 계속 진행할 수 있습니다.
          </p>
        </div>
      </li>
    </ol>

    <div class="auto-trouble" role="note" aria-label="자동 모드가 막힐 때 확인할 것">
      <h4 class="auto-trouble-title">막히면 여기부터 확인하세요</h4>
      <ul class="auto-check-list">
        <li><code>node -v</code>, <code>npm -v</code>가 안 나오면 Node.js LTS를 설치한 뒤 PowerShell을 새로 엽니다.</li>
        <li><code>codex --version</code>이 안 나오면 <code>npm i -g &#64;openai/codex</code> 설치가 끝났는지 확인합니다.</li>
        <li>로그인했는데 앱이 못 찾으면 앱의 [로그인] 화면에서 [다시 검출]을 누르거나 앱을 재시작합니다.</li>
        <li>자동 추출이 중간에 막히면 고장으로 보지 말고, 같은 후보를 복붙 모드로 정리하면 됩니다.</li>
      </ul>
    </div>

    <p class="auto-setup-note" role="note">
      codex는 자동 모드가 동작하는 동안 백그라운드에서 내 계정 인증을 이어 주는
      도우미예요. 한 번 설치·로그인해 두면 계속 쓸 수 있고, 컴퓨터에 그대로 두면
      됩니다. 자동 모드가 잘 안 되거나 설치가 어려우면 언제든
      <strong>방법 A(후보별 복붙)</strong>로 같은 검증 흐름을 계속 진행할 수 있으니
      걱정하지 마세요.
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

  kbd {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.75em;
    padding: 0 var(--space-xs);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-base);
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
